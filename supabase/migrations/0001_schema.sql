-- =============================================================
--  Menu Digital · esquema base
--  Multi-tenant: cada restaurante es un tenant aislado por RLS.
-- =============================================================
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------- Tipos ----------
do $$ begin
  create type app_role            as enum ('superadmin','restaurant','customer');
  create type staff_role          as enum ('owner','admin','manager','waiter','kitchen','cashier');
  create type plan_interval       as enum ('month','year');
  create type subscription_status as enum ('trialing','active','past_due','canceled','expired');
  create type order_type          as enum ('dine_in','delivery','pickup');
  create type order_status        as enum ('pending','confirmed','preparing','ready','delivering','completed','cancelled');
  create type order_item_status   as enum ('queued','preparing','ready','served');
  create type payment_method      as enum ('cash','card','tpv','stripe');
  create type payment_status      as enum ('pending','paid','failed','refunded');
  create type call_type           as enum ('waiter','bill','water','help');
  create type call_status         as enum ('pending','attended','cancelled');
exception when duplicate_object then null; end $$;

-- ---------- Utilidades ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- unaccent no está garantizado en todas las instalaciones: fallback manual.
create or replace function public.unaccent_fallback(txt text)
returns text language sql immutable as $$
  select translate(txt,
    'áàäâãåÁÀÄÂÃÅéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC');
$$;

-- Convierte un texto en slug url-safe.
create or replace function public.slugify(txt text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    lower(public.unaccent_fallback(txt)), '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------- Perfiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  avatar_url  text,
  role        app_role not null default 'customer',
  locale      text not null default 'es',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Alta automática de perfil al registrarse un usuario.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
    new.raw_user_meta_data->>'avatar_url',
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Planes de suscripción ----------
create table if not exists public.plans (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  interval          plan_interval not null,
  price_cents       integer not null check (price_cents >= 0),
  currency          char(3) not null default 'EUR',
  trial_days        integer not null default 0 check (trial_days >= 0),
  max_tables        integer,          -- null = ilimitado
  max_products      integer,
  max_staff         integer,
  allows_3d         boolean not null default true,
  allows_delivery   boolean not null default true,
  features          jsonb not null default '[]'::jsonb,
  stripe_price_id   text,
  stripe_product_id text,
  is_active         boolean not null default true,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- Restaurantes ----------
create table if not exists public.restaurants (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid references public.profiles(id) on delete set null,
  slug               text not null unique,
  name               text not null,
  description        text,
  logo_url           text,
  cover_url          text,
  phone              text,
  email              text,
  address            text,
  city               text,
  country            char(2) default 'ES',
  lat                double precision,
  lng                double precision,
  currency           char(3) not null default 'EUR',
  currency_decimals  smallint not null default 2 check (currency_decimals between 0 and 3),
  locale             text not null default 'es',
  timezone           text not null default 'Europe/Madrid',
  primary_color      text not null default '#FF7622',
  cuisine_tags       text[] not null default '{}',
  rating             numeric(2,1) not null default 0,
  rating_count       integer not null default 0,
  avg_prep_minutes   integer not null default 20,
  delivery_enabled   boolean not null default true,
  pickup_enabled     boolean not null default true,
  dinein_enabled     boolean not null default true,
  delivery_fee_cents integer not null default 0,
  min_order_cents    integer not null default 0,
  tax_rate           numeric(5,4) not null default 0,   -- 0.21 = 21%
  accepts_cash       boolean not null default true,
  accepts_card       boolean not null default true,
  accepts_tpv        boolean not null default true,
  opening_hours      jsonb not null default '{}'::jsonb,
  is_active          boolean not null default true,
  is_open            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists restaurants_active_idx on public.restaurants (is_active) where is_active;
create index if not exists restaurants_owner_idx  on public.restaurants (owner_id);

-- ---------- Suscripciones ----------
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null references public.restaurants(id) on delete cascade,
  plan_id                uuid references public.plans(id) on delete restrict,
  status                 subscription_status not null default 'trialing',
  current_period_start   timestamptz not null default now(),
  current_period_end     timestamptz not null,
  cancel_at_period_end   boolean not null default false,
  stripe_customer_id     text,
  stripe_subscription_id text,
  assigned_by            uuid references public.profiles(id) on delete set null,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists subscriptions_one_active_per_restaurant
  on public.subscriptions (restaurant_id)
  where status in ('trialing','active','past_due');
create index if not exists subscriptions_restaurant_idx on public.subscriptions (restaurant_id);

create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  restaurant_id            uuid not null references public.restaurants(id) on delete cascade,
  subscription_id          uuid references public.subscriptions(id) on delete set null,
  plan_id                  uuid references public.plans(id) on delete set null,
  amount_cents             integer not null,
  currency                 char(3) not null default 'EUR',
  status                   payment_status not null default 'pending',
  stripe_checkout_id       text,
  stripe_payment_intent_id text,
  stripe_invoice_id        text,
  paid_at                  timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists payments_restaurant_idx on public.payments (restaurant_id, created_at desc);

-- ---------- Equipo ----------
create table if not exists public.restaurant_staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          staff_role not null default 'waiter',
  pin           text,                      -- acceso rápido a KDS/TPV
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, user_id)
);
create index if not exists staff_user_idx on public.restaurant_staff (user_id) where is_active;

-- ---------- Mesas ----------
create table if not exists public.tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code          text not null unique,      -- va en la URL del QR: /m/<code>
  name          text not null,             -- "Mesa 7"
  zone          text,                      -- "Terraza", "Salón"
  seats         smallint not null default 4,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);
create index if not exists tables_restaurant_idx on public.tables (restaurant_id);

-- ---------- Carta ----------
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  description   text,
  image_url     text,
  position      integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists categories_restaurant_idx on public.categories (restaurant_id, position);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  category_id        uuid references public.categories(id) on delete set null,
  name               text not null,
  description        text,
  price_cents        integer not null check (price_cents >= 0),
  compare_at_cents   integer,
  image_url          text,
  gallery            jsonb not null default '[]'::jsonb,
  model_3d_url       text,        -- .glb  → visor 3D + AR Android
  model_ar_url       text,        -- .usdz → AR Quick Look en iOS
  model_scale        numeric(6,3) not null default 1,
  prep_minutes       integer not null default 15,
  calories           integer,
  ingredients        text[] not null default '{}',
  allergens          text[] not null default '{}',
  tags               text[] not null default '{}',
  rating             numeric(2,1) not null default 0,
  rating_count       integer not null default 0,
  is_available       boolean not null default true,
  is_featured        boolean not null default false,
  position           integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists products_restaurant_idx on public.products (restaurant_id, position);
create index if not exists products_category_idx   on public.products (category_id);
create index if not exists products_search_idx     on public.products using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'')));

-- Grupos de opciones ("Tamaño", "Extras") y sus opciones.
create table if not exists public.option_groups (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,
  min_select  smallint not null default 0,
  max_select  smallint not null default 1,
  is_required boolean not null default false,
  position    integer not null default 0
);
create index if not exists option_groups_product_idx on public.option_groups (product_id, position);

create table if not exists public.options (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.option_groups(id) on delete cascade,
  name              text not null,
  price_delta_cents integer not null default 0,
  is_default        boolean not null default false,
  is_available      boolean not null default true,
  position          integer not null default 0
);
create index if not exists options_group_idx on public.options (group_id, position);

-- ---------- Pedidos ----------
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants(id) on delete cascade,
  table_id           uuid references public.tables(id) on delete set null,
  customer_id        uuid references public.profiles(id) on delete set null,
  public_token       uuid not null default gen_random_uuid(),  -- seguimiento sin login
  code               text not null,                            -- "#162432"
  type               order_type not null default 'delivery',
  status             order_status not null default 'pending',
  customer_name      text,
  customer_phone     text,
  customer_email     text,
  address            text,
  address_notes      text,
  lat                double precision,
  lng                double precision,
  payment_method     payment_method not null default 'cash',
  payment_status     payment_status not null default 'pending',
  stripe_payment_intent_id text,
  currency           char(3) not null default 'EUR',
  subtotal_cents     integer not null default 0,
  delivery_fee_cents integer not null default 0,
  tax_cents          integer not null default 0,
  discount_cents     integer not null default 0,
  tip_cents          integer not null default 0,
  total_cents        integer not null default 0,
  notes              text,
  scheduled_for      timestamptz,
  accepted_at        timestamptz,
  ready_at           timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists orders_token_idx on public.orders (public_token);
create index if not exists orders_restaurant_status_idx on public.orders (restaurant_id, status, created_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);
create index if not exists orders_table_idx on public.orders (table_id, created_at desc);

create table if not exists public.order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  product_id        uuid references public.products(id) on delete set null,
  name_snapshot     text not null,
  image_snapshot    text,
  unit_price_cents  integer not null,
  quantity          integer not null default 1 check (quantity > 0),
  options           jsonb not null default '[]'::jsonb,  -- [{group,name,price_delta_cents}]
  options_total_cents integer not null default 0,
  line_total_cents  integer not null default 0,
  status            order_item_status not null default 'queued',
  notes             text,
  created_at        timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items (order_id);

-- Historial de estados: alimenta la línea de tiempo del seguimiento.
create table if not exists public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      order_status not null,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- ---------- Llamadas de mesa ----------
create table if not exists public.waiter_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id      uuid not null references public.tables(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  type          call_type not null default 'waiter',
  status        call_status not null default 'pending',
  note          text,
  attended_by   uuid references public.profiles(id) on delete set null,
  attended_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists waiter_calls_pending_idx on public.waiter_calls (restaurant_id, status, created_at desc);

-- ---------- Reseñas y favoritos ----------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  product_id    uuid references public.products(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  customer_id   uuid references public.profiles(id) on delete set null,
  author_name   text,
  rating        smallint not null check (rating between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now()
);
create index if not exists reviews_restaurant_idx on public.reviews (restaurant_id, created_at desc);

create table if not exists public.favorites (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------- Triggers updated_at ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','plans','restaurants','subscriptions','restaurant_staff',
                           'tables','categories','products','orders']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
