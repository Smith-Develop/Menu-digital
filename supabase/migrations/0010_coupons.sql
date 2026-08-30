-- =============================================================
--  Yumi · cupones, invitaciones de equipo e impresión de tickets
-- =============================================================

do $$ begin
  create type coupon_kind   as enum ('percentage','fixed','free_delivery');
  create type coupon_target as enum ('order','products','categories');
exception when duplicate_object then null; end $$;

-- ---------- Cupones ----------
-- restaurant_id null = cupón del superadministrador, válido en cualquier local.
create table if not exists public.coupons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  restaurant_id      uuid references public.restaurants(id) on delete cascade,
  kind               coupon_kind not null,
  percentage         numeric(5,2) check (percentage is null or (percentage > 0 and percentage <= 100)),
  value_cents        integer check (value_cents is null or value_cents > 0),
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents > 0),
  target             coupon_target not null default 'order',
  min_order_cents    integer not null default 0 check (min_order_cents >= 0),
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  max_redemptions    integer check (max_redemptions is null or max_redemptions > 0),
  max_per_customer   integer not null default 1 check (max_per_customer > 0),
  redemptions_count  integer not null default 0,
  is_active          boolean not null default true,
  description        text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Cada tipo necesita su propio dato: sin esto se podrían guardar cupones
  -- de porcentaje sin porcentaje o de importe fijo sin importe.
  constraint coupons_value_matches_kind check (
    (kind = 'percentage'    and percentage is not null and value_cents is null)
    or (kind = 'fixed'      and value_cents is not null and percentage is null)
    or (kind = 'free_delivery')
  )
);

-- Un código global es único en toda la plataforma; uno de restaurante, solo
-- dentro de su local, para que dos restaurantes puedan usar "VERANO10" a la vez.
create unique index if not exists coupons_global_code_idx
  on public.coupons (upper(code)) where restaurant_id is null;
create unique index if not exists coupons_restaurant_code_idx
  on public.coupons (restaurant_id, upper(code)) where restaurant_id is not null;
create index if not exists coupons_live_idx
  on public.coupons (is_active, starts_at) where is_active;

-- Alcance del descuento cuando no aplica a todo el pedido.
create table if not exists public.coupon_products (
  coupon_id  uuid not null references public.coupons(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (coupon_id, product_id)
);

create table if not exists public.coupon_categories (
  coupon_id   uuid not null references public.coupons(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (coupon_id, category_id)
);

create table if not exists public.coupon_redemptions (
  id             uuid primary key default gen_random_uuid(),
  coupon_id      uuid not null references public.coupons(id) on delete cascade,
  order_id       uuid references public.orders(id) on delete set null,
  restaurant_id  uuid references public.restaurants(id) on delete set null,
  customer_id    uuid references public.profiles(id) on delete set null,
  discount_cents integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, customer_id);

-- El pedido guarda qué cupón se aplicó, para el ticket y las devoluciones.
alter table public.orders add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
alter table public.orders add column if not exists coupon_code text;

-- ---------- Invitaciones de equipo ----------
-- Alta sin claves de administración: el restaurante genera una invitación y la
-- persona la acepta con su propia cuenta, en lugar de crearle credenciales.
create table if not exists public.staff_invitations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  email         text not null,
  role          staff_role not null default 'waiter',
  as_courier    boolean not null default false,
  token         text not null unique,
  invited_by    uuid references public.profiles(id) on delete set null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz not null default now() + interval '14 days',
  created_at    timestamptz not null default now()
);
create index if not exists staff_invitations_restaurant_idx
  on public.staff_invitations (restaurant_id, accepted_at);
create index if not exists staff_invitations_email_idx
  on public.staff_invitations (lower(email)) where accepted_at is null;

-- ---------- Impresión de tickets ----------
alter table public.restaurants add column if not exists print_settings jsonb not null
  default '{"paper":"80mm","autoPrint":false,"copies":1,"showLogo":true,"footerNote":null}'::jsonb;

-- ---------- Triggers ----------
do $$
declare t text;
begin
  foreach t in array array['coupons']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
