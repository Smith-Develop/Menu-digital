-- =============================================================
--  Fase E · vender el sitio en la portada
--
--  La plataforma cobra hoy por dos vías: la cuota del plan y la comisión sobre
--  lo vendido. Las dos suben con el negocio del local, pero ninguna de las dos
--  vende lo único de lo que la plataforma tiene existencias limitadas, que es
--  la atención de quien abre la aplicación con hambre.
--
--  Eso es lo que se pone a la venta aquí: aparecer arriba en la lista de tu
--  ciudad, y aparecer en el carrusel de la portada. Con tres condiciones que no
--  son opcionales.
--
--  La primera es que se vea. Un resultado pagado que no se distingue de uno
--  ganado engaña al cliente y, a la larga, quema la lista entera: la fila lleva
--  su etiqueta y no hay forma de comprar una que no la lleve.
--
--  La segunda es que haya cupo. Si se pueden vender veinte destacados por
--  ciudad, la lista deja de ser una lista. El cupo lo fija la plataforma por
--  ciudad, y la reserva lo respeta contando los días que se solapan.
--
--  La tercera es que sólo se enseñe lo cobrado. Reservar aparta el sitio; lo
--  que lo enciende es que alguien confirme el cobro.
-- =============================================================

do $$ begin
  create type sponsorship_kind as enum ('listing', 'banner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sponsorship_status as enum ('reserved', 'active', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 1 · Lo que la plataforma pone a la venta
-- ---------------------------------------------------------------
create table if not exists public.sponsorship_offers (
  id          uuid primary key default gen_random_uuid(),

  -- Nulo es "en toda la aplicación": la portada sin ciudad elegida.
  city_slug   text,
  kind        sponsorship_kind not null,

  price_cents integer not null default 0 check (price_cents >= 0),
  currency    char(3) not null default 'EUR',
  -- Cuántos sitios hay a la vez. Es el número que hace que esto valga algo.
  slots       integer not null default 1 check (slots > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Una oferta por ciudad y tipo. El índice va sobre una expresión porque en SQL
-- dos nulos no son iguales, y sin esto habría diez ofertas "de toda la app".
create unique index if not exists sponsorship_offers_unique
  on public.sponsorship_offers (coalesce(city_slug, ''), kind);

comment on column public.sponsorship_offers.price_cents is
  'Precio por día. Se congela en cada contratación: subirlo no reescribe lo vendido.';

-- ---------------------------------------------------------------
-- 2 · Lo que un local ha contratado
-- ---------------------------------------------------------------
create table if not exists public.sponsorships (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  offer_id      uuid references public.sponsorship_offers(id) on delete set null,

  kind          sponsorship_kind not null,
  city_slug     text,

  starts_on     date not null,
  ends_on       date not null,

  -- Congelados en el momento de contratar, como en las facturas: lo vendido no
  -- cambia porque cambie la tarifa.
  price_cents   integer not null default 0,
  currency      char(3) not null default 'EUR',
  days          integer not null default 1,
  total_cents   integer not null default 0,

  status        sponsorship_status not null default 'reserved',
  paid_at       timestamptz,
  paid_by       uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  check (ends_on >= starts_on)
);

create index if not exists sponsorships_vigentes_idx
  on public.sponsorships (city_slug, kind, starts_on, ends_on)
  where status = 'active';

create index if not exists sponsorships_restaurant_idx
  on public.sponsorships (restaurant_id, starts_on desc);

/**
 * El cupo, comprobado sobre los días que se solapan.
 *
 * Dos contrataciones distintas de la misma ciudad chocan si comparten un solo
 * día, así que no basta con contar las de hoy. Las canceladas no ocupan; las
 * reservadas sí, porque reservar es exactamente apartar el sitio mientras se
 * paga.
 */
create or replace function public.guard_sponsorship_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cupo    int;
  v_ocupados int;
begin
  if new.status = 'cancelled' then return new; end if;

  select o.slots into v_cupo
    from public.sponsorship_offers o
   where coalesce(o.city_slug, '') = coalesce(new.city_slug, '')
     and o.kind = new.kind
     and o.is_active;

  -- Sin oferta publicada no hay nada que vender: lo crea el superadministrador
  -- y hasta entonces la ciudad no está a la venta.
  if v_cupo is null then
    raise exception 'SPONSORSHIP_NOT_OFFERED' using errcode = 'P0001';
  end if;

  select count(*) into v_ocupados
    from public.sponsorships s
   where s.id <> new.id
     and s.status <> 'cancelled'
     and s.kind = new.kind
     and coalesce(s.city_slug, '') = coalesce(new.city_slug, '')
     and s.starts_on <= new.ends_on
     and s.ends_on   >= new.starts_on;

  if v_ocupados >= v_cupo then
    raise exception 'SPONSORSHIP_FULL' using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists sponsorships_guard on public.sponsorships;
create trigger sponsorships_guard
  before insert or update of starts_on, ends_on, status, kind, city_slug
  on public.sponsorships
  for each row execute function public.guard_sponsorship_slots();

-- ---------------------------------------------------------------
-- 3 · Contratar
-- ---------------------------------------------------------------
/**
 * Reserva un destacado para un local.
 *
 * Queda reservado, no activo: aparta el sitio frente a otro que lo quiera esos
 * mismos días, pero no se enseña a nadie hasta que se confirma el cobro. Es la
 * misma idea que rige las suscripciones —lo que se ve es lo pagado— y evita el
 * caso feo de un destacado gratis que nadie recuerda haber regalado.
 */
create or replace function public.reserve_sponsorship(
  p_restaurant_id uuid,
  p_kind          sponsorship_kind,
  p_starts_on     date,
  p_ends_on       date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest  public.restaurants;
  v_oferta public.sponsorship_offers;
  v_dias  int;
  v_id    uuid;
begin
  select * into v_rest from public.restaurants where id = p_restaurant_id;
  if not found then raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.is_staff_of(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_starts_on < (now() at time zone coalesce(v_rest.timezone, 'UTC'))::date then
    raise exception 'SPONSORSHIP_IN_THE_PAST' using errcode = 'P0001';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'SPONSORSHIP_BAD_RANGE' using errcode = 'P0001';
  end if;

  -- La oferta de su ciudad; si esa ciudad no está a la venta, la general.
  select * into v_oferta from public.sponsorship_offers
   where is_active and kind = p_kind
     and coalesce(city_slug, '') in (coalesce(v_rest.city_slug, ''), '')
   order by (city_slug is not null) desc
   limit 1;

  if not found then raise exception 'SPONSORSHIP_NOT_OFFERED' using errcode = 'P0001'; end if;

  -- Los dos extremos incluidos: contratar "del 3 al 3" es un día, no cero.
  v_dias := (p_ends_on - p_starts_on) + 1;

  insert into public.sponsorships (
    restaurant_id, offer_id, kind, city_slug, starts_on, ends_on,
    price_cents, currency, days, total_cents, status, created_by
  ) values (
    p_restaurant_id, v_oferta.id, p_kind, v_oferta.city_slug, p_starts_on, p_ends_on,
    v_oferta.price_cents, v_oferta.currency, v_dias,
    v_oferta.price_cents * v_dias, 'reserved', auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id,
                            'days', v_dias, 'total_cents', v_oferta.price_cents * v_dias);
end $$;

/** Confirmar el cobro es lo que enciende el destacado. Sólo la plataforma. */
create or replace function public.activate_sponsorship(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_s public.sponsorships;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.sponsorships
     set status = 'active', paid_at = coalesce(paid_at, now()), paid_by = auth.uid()
   where id = p_id and status <> 'cancelled'
  returning * into v_s;

  if not found then raise exception 'SPONSORSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'total_cents', v_s.total_cents);
end $$;

create or replace function public.cancel_sponsorship(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_s public.sponsorships;
begin
  select * into v_s from public.sponsorships where id = p_id;
  if not found then raise exception 'SPONSORSHIP_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Un destacado ya cobrado lo cancela quien cobró, no quien lo contrató.
  if v_s.status = 'active' and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not public.is_staff_of(v_s.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.sponsorships set status = 'cancelled' where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------
-- 4 · Quién está destacado ahora mismo
-- ---------------------------------------------------------------
/**
 * Los locales destacados de una ciudad, hoy.
 *
 * Devuelve además el identificador de la contratación para poder medir después
 * qué dio de sí lo que se vendió; sin eso, renovar es un acto de fe.
 */
create or replace function public.sponsored_restaurants(
  p_city_slug text default null,
  p_kind      sponsorship_kind default 'listing'
)
returns table (restaurant_id uuid, sponsorship_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.restaurant_id, s.id
  from public.sponsorships s
  join public.restaurants r on r.id = s.restaurant_id
  where s.status = 'active'
    and s.kind = p_kind
    and current_date between s.starts_on and s.ends_on
    and r.is_active
    and public.restaurant_is_live(r.id)
    -- Una ciudad concreta ve lo suyo y lo contratado para toda la aplicación.
    and (s.city_slug is null or p_city_slug is null or s.city_slug = p_city_slug)
  order by s.created_at;
$$;

-- ---------------------------------------------------------------
-- 5 · Permisos
-- ---------------------------------------------------------------
alter table public.sponsorship_offers enable row level security;
alter table public.sponsorship_offers force row level security;

drop policy if exists sponsorship_offers_read on public.sponsorship_offers;
create policy sponsorship_offers_read on public.sponsorship_offers
  for select to anon, authenticated using (is_active);

drop policy if exists sponsorship_offers_write on public.sponsorship_offers;
create policy sponsorship_offers_write on public.sponsorship_offers
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

alter table public.sponsorships enable row level security;
alter table public.sponsorships force row level security;

drop policy if exists sponsorships_read on public.sponsorships;
create policy sponsorships_read on public.sponsorships
  for select to authenticated
  using (public.is_superadmin() or public.is_staff_of(restaurant_id));

drop policy if exists sponsorships_write on public.sponsorships;
create policy sponsorships_write on public.sponsorships
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

grant select on public.sponsorship_offers to anon, authenticated;
grant insert, update, delete on public.sponsorship_offers to authenticated;
grant select on public.sponsorships to authenticated;
grant insert, update, delete on public.sponsorships to authenticated;

grant execute on function public.reserve_sponsorship(uuid, sponsorship_kind, date, date) to authenticated;
grant execute on function public.activate_sponsorship(uuid) to authenticated;
grant execute on function public.cancel_sponsorship(uuid) to authenticated;
grant execute on function public.sponsored_restaurants(text, sponsorship_kind) to anon, authenticated;
