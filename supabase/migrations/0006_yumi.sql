-- =============================================================
--  Yumi · ciudades, banners, repartidores, marca y notificaciones
-- =============================================================

-- ---------- Tipos nuevos ----------
do $$ begin
  create type courier_status as enum ('offline','available','busy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_audience as enum ('all','cities');
exception when duplicate_object then null; end $$;

-- El repartidor es un rol global: puede trabajar para varios restaurantes.
do $$ begin
  alter type app_role add value if not exists 'courier';
exception when duplicate_object then null; end $$;

-- ---------- Ciudad normalizada ----------
-- El cliente solo ve restaurantes de su ciudad, así que la comparación tiene
-- que ser estable frente a tildes y mayúsculas: guardamos el slug calculado.
alter table public.restaurants
  add column if not exists city_slug text
  generated always as (public.slugify(coalesce(city, ''))) stored;

create index if not exists restaurants_city_idx
  on public.restaurants (city_slug) where is_active;

-- ---------- Personalización del restaurante ----------
alter table public.restaurants
  add column if not exists accent_color text not null default '#FFCA28';
alter table public.restaurants
  add column if not exists text_color text not null default '#1A1817';

-- ---------- Banners promocionales ----------
create table if not exists public.banners (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title         text,
  subtitle      text,
  image_url     text not null,
  link_url      text,
  position      integer not null default 0,
  is_active     boolean not null default true,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists banners_restaurant_idx on public.banners (restaurant_id, position);
create index if not exists banners_active_idx on public.banners (is_active) where is_active;

-- ---------- Repartidores ----------
create table if not exists public.couriers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.profiles(id) on delete cascade,
  phone               text,
  vehicle             text not null default 'moto',   -- foot | bike | moto | car
  status              courier_status not null default 'offline',
  city                text,
  lat                 double precision,
  lng                 double precision,
  location_updated_at timestamptz,
  rating              numeric(2,1) not null default 0,
  rating_count        integer not null default 0,
  deliveries_count    integer not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.couriers
  add column if not exists city_slug text
  generated always as (public.slugify(coalesce(city, ''))) stored;
create index if not exists couriers_status_idx on public.couriers (status) where is_active;

-- Un repartidor puede trabajar para varios restaurantes a la vez.
create table if not exists public.restaurant_couriers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  courier_id    uuid not null references public.couriers(id) on delete cascade,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, courier_id)
);
create index if not exists restaurant_couriers_courier_idx
  on public.restaurant_couriers (courier_id) where is_active;

alter table public.orders add column if not exists courier_id uuid references public.couriers(id) on delete set null;
alter table public.orders add column if not exists picked_up_at timestamptz;
create index if not exists orders_courier_idx on public.orders (courier_id, status);

-- ---------- Marca de la aplicación (fila única) ----------
create table if not exists public.app_settings (
  id             boolean primary key default true check (id),
  app_name       text not null default 'Yumi',
  tagline        text not null default 'Tu comida favorita, en minutos.',
  description    text not null default 'Pide la mejor comida a domicilio con Yumi. Encuentra tus restaurantes favoritos, realiza el seguimiento en tiempo real y disfruta entregas ultra rápidas.',
  logo_url       text,
  icon_url       text,
  primary_color  text not null default '#FF7622',
  accent_color   text not null default '#FFCA28',
  text_color     text not null default '#1A1817',
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ---------- Notificaciones emergentes ----------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  image_url   text,
  link_url    text,
  link_label  text,
  audience    notification_audience not null default 'all',
  cities      text[] not null default '{}',   -- slugs de ciudad
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notifications_live_idx
  on public.notifications (is_active, starts_at) where is_active;

-- ---------- Triggers updated_at ----------
do $$
declare t text;
begin
  foreach t in array array['banners','couriers','notifications','app_settings']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
