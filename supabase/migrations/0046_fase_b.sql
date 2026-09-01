-- =============================================================
--  Fase B · la suscripción deja de ser de un restaurante
--
--  `subscriptions.restaurant_id` era obligatorio y un índice único impedía más
--  de una activa por local. Con eso, cobrar a un repartidor no era "crear unos
--  planes": no había forma de que una persona pagara nada.
--
--  La suscripción pasa a pertenecer a un sujeto —un negocio o una persona— y
--  el plan gana una audiencia, para que el formulario no ofrezca planes de
--  repartidor a un restaurante ni al revés.
--
--  `restaurant_id` se conserva y lo mantiene un disparador a partir del sujeto.
--  No es una segunda verdad: es una columna derivada, y evita reescribir las
--  seis consultas de SQL y la docena de sitios de la aplicación que la leen.
-- =============================================================

do $$ begin
  create type subscription_subject as enum ('restaurant', 'courier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_audience as enum ('restaurant', 'courier');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 1 · La suscripción tiene un sujeto
-- ---------------------------------------------------------------
alter table public.subscriptions
  add column if not exists subject_type subscription_subject not null default 'restaurant',
  add column if not exists subject_id   uuid;

update public.subscriptions set subject_id = restaurant_id where subject_id is null;

alter table public.subscriptions alter column subject_id set not null;
alter table public.subscriptions alter column restaurant_id drop not null;

/**
 * `restaurant_id` se deriva del sujeto.
 *
 * Escribirlo a mano en dos sitios acabaría con las dos columnas discrepando,
 * que es exactamente el problema que esta migración viene a resolver en otro
 * plano.
 */
create or replace function public.sync_subscription_subject()
returns trigger language plpgsql as $$
begin
  -- Compatibilidad hacia atrás: quien todavía inserte por `restaurant_id` sin
  -- indicar sujeto obtiene el sujeto correcto sin enterarse.
  if new.subject_id is null and new.restaurant_id is not null then
    new.subject_type := 'restaurant';
    new.subject_id := new.restaurant_id;
  end if;

  new.restaurant_id := case
    when new.subject_type = 'restaurant' then new.subject_id
    else null
  end;
  return new;
end $$;

drop trigger if exists subscriptions_sync_subject on public.subscriptions;
create trigger subscriptions_sync_subject
  before insert or update on public.subscriptions
  for each row execute function public.sync_subscription_subject();

drop index if exists public.subscriptions_one_active_per_restaurant;
create unique index if not exists subscriptions_one_active_per_subject
  on public.subscriptions (subject_type, subject_id)
  where status in ('trialing', 'active', 'past_due');

create index if not exists subscriptions_subject_idx
  on public.subscriptions (subject_type, subject_id);

-- ---------------------------------------------------------------
-- 2 · El plan sabe a quién va dirigido
--
-- A un negocio se le vende capacidad —cuántos productos, cuánto equipo—; a un
-- repartidor se le vende acceso al trabajo, que es lo único que quiere. Son
-- límites distintos y conviven en la misma tabla porque el ciclo de cobro es
-- idéntico.
-- ---------------------------------------------------------------
alter table public.plans
  add column if not exists audience plan_audience not null default 'restaurant',
  -- Para cuántos locales puede trabajar. Nulo es sin límite.
  add column if not exists max_restaurants integer,
  -- Si puede coger pedidos de la bolsa común o sólo esperar a que le asignen.
  add column if not exists allows_pool boolean not null default true,
  -- A igualdad de condiciones, quién ve antes un pedido de la bolsa.
  add column if not exists pool_priority smallint not null default 0;

comment on column public.plans.audience is
  'A quién se le vende: un negocio o un repartidor. Los límites de cada uno son distintos.';

-- ---------------------------------------------------------------
-- 3 · El plan vigente de un repartidor
-- ---------------------------------------------------------------
create or replace function public.courier_plan(p_courier_id uuid default null)
returns public.plans
language sql
stable
security definer
set search_path = public
as $$
  select pl.*
  from public.subscriptions s
  join public.plans pl on pl.id = s.plan_id
  where s.subject_type = 'courier'
    and s.subject_id = coalesce(p_courier_id, public.my_courier_id())
    and s.status in ('trialing', 'active', 'past_due')
    and s.current_period_end > now()
  order by s.created_at desc
  limit 1;
$$;

/**
 * ¿Puede este repartidor coger de la bolsa común?
 *
 * Sin plan asignado se le deja: un repartidor recién llegado tiene que poder
 * trabajar mientras alguien decide qué plan le corresponde, y bloquearlo por
 * defecto sería quedarse sin flota por un descuido administrativo.
 */
create or replace function public.courier_can_use_pool(p_courier_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((public.courier_plan(p_courier_id)).allows_pool, true);
$$;

grant execute on function public.courier_plan(uuid) to authenticated;
grant execute on function public.courier_can_use_pool(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 4 · Los límites se aplican
-- ---------------------------------------------------------------

/** Cuántos locales admite el plan del repartidor. */
create or replace function public.guard_courier_restaurants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_n   int;
begin
  if not new.is_active then return new; end if;

  v_max := (public.courier_plan(new.courier_id)).max_restaurants;
  if v_max is null then return new; end if;

  select count(*) into v_n
    from public.restaurant_couriers
   where courier_id = new.courier_id
     and is_active
     and restaurant_id <> new.restaurant_id;

  if v_n >= v_max then
    raise exception 'PLAN_LIMIT_RESTAURANTS:%', v_max using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists restaurant_couriers_plan_limit on public.restaurant_couriers;
create trigger restaurant_couriers_plan_limit
  before insert or update on public.restaurant_couriers
  for each row execute function public.guard_courier_restaurants();

/**
 * Coger un pedido de la bolsa común pasa a depender del plan.
 *
 * Es lo único que un repartidor quiere comprar: llegar antes al trabajo. Sin
 * esto, todos los planes serían el mismo.
 */
create or replace function public.courier_take_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_courier uuid := public.my_courier_id();
  v_updated int;
begin
  if v_courier is null then
    raise exception 'NOT_A_COURIER' using errcode = 'P0001';
  end if;

  if not public.courier_can_use_pool(v_courier) then
    raise exception 'PLAN_NO_POOL' using errcode = 'P0001';
  end if;

  update public.orders o
     set courier_id = v_courier,
         status = 'delivering',
         picked_up_at = coalesce(picked_up_at, now())
   where o.id = p_order_id
     and o.courier_id is null
     and o.type = 'delivery'
     and o.status = 'ready'
     and public.courier_works_for(o.restaurant_id);

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.couriers set status = 'busy' where id = v_courier;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'courier_id', v_courier);
end $$;

-- ---------------------------------------------------------------
-- 5 · Acceso: el repartidor ve su propia suscripción
-- ---------------------------------------------------------------
drop policy if exists subscriptions_courier_read on public.subscriptions;
create policy subscriptions_courier_read on public.subscriptions
  for select to authenticated
  using (subject_type = 'courier' and subject_id = public.my_courier_id());

-- Los planes ya eran de lectura pública para poder enseñarlos en la tienda.

-- ---------------------------------------------------------------
-- 6 · Tres planes de repartidor para empezar
--
-- El gratuito con comisión es la puerta de entrada: cobrar cuota a un
-- repartidor sólo funciona cuando hay pedidos que repartir, y en una ciudad que
-- arranca un plan de pago espanta a la flota justo cuando más falta hace.
-- ---------------------------------------------------------------
insert into public.plans (
  name, description, interval, price_cents, currency, trial_days,
  audience, max_restaurants, allows_pool, pool_priority,
  allows_3d, allows_delivery, features, is_active, position
) values
  ('Repartidor Libre',
   'Para empezar. Trabajas con un restaurante y recibes los pedidos que te asignen.',
   'month', 0, 'EUR', 0, 'courier', 1, false, 0,
   false, true,
   '["Un restaurante", "Sólo pedidos asignados", "Liquidación de efectivo"]'::jsonb, true, 10),

  ('Repartidor Autónomo',
   'Coges pedidos de la bolsa común y trabajas para varios restaurantes.',
   'month', 900, 'EUR', 14, 'courier', 3, true, 1,
   false, true,
   '["Hasta tres restaurantes", "Bolsa común de pedidos", "Tus ganancias y tu historial"]'::jsonb, true, 11),

  ('Repartidor Flota',
   'Sin límite de restaurantes y con prioridad sobre el resto en la bolsa.',
   'month', 1900, 'EUR', 14, 'courier', null, true, 10,
   false, true,
   '["Restaurantes ilimitados", "Prioridad en la bolsa", "Estadísticas"]'::jsonb, true, 12)
on conflict do nothing;
