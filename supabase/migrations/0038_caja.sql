-- =============================================================
--  Fase 2 de la auditoría · caja y turno
--
--  Hasta ahora el sistema sabía cuánto se había cobrado, pero nunca comparaba
--  esa cifra con el dinero que había realmente en el cajón. Sin apertura con
--  fondo, cierre con recuento y descuadre, un panel de pedidos no llega a ser
--  un TPV: no hay forma de saber si falta dinero, ni cuánto, ni de qué turno.
--
--  Un matiz que decide todo el cálculo: el efectivo que cobra un repartidor en
--  la puerta NO está en el cajón, está en su bolsillo. No puede contar como
--  efectivo esperado hasta que lo liquida. Confundir las dos cosas haría que
--  toda caja con reparto saliera descuadrada por defecto.
-- =============================================================

do $$ begin
  create type cash_session_status as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_movement_kind as enum (
    'payout',              -- pago a proveedor, gasto del día
    'withdrawal',          -- retirada de efectivo a la caja fuerte o al banco
    'deposit',             -- aportación de efectivo al cajón
    'courier_settlement',  -- el sobre que trae el repartidor
    'tip_out',             -- reparto de propinas al equipo
    'correction',          -- ajuste con motivo
    'other'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 1 · El turno de caja
-- ---------------------------------------------------------------
create table if not exists public.cash_sessions (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  status         cash_session_status not null default 'open',

  opened_at      timestamptz not null default now(),
  opened_by      uuid references public.profiles(id) on delete set null,
  -- Con cuánto se empieza. Sin este dato el recuento del cierre no significa
  -- nada: no se sabe cuánto de lo que hay en el cajón es venta.
  opening_float_cents integer not null default 0,

  closed_at      timestamptz,
  closed_by      uuid references public.profiles(id) on delete set null,
  -- Lo que se contó a mano frente a lo que el sistema dice que debería haber.
  counted_cents  integer,
  expected_cents integer,
  variance_cents integer,

  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists cash_sessions_restaurant_idx
  on public.cash_sessions (restaurant_id, opened_at desc);

-- Una caja abierta por local y no más: dos turnos simultáneos harían que cada
-- cobro pudiera caer en cualquiera de los dos y ningún arqueo cuadraría.
create unique index if not exists cash_sessions_one_open_idx
  on public.cash_sessions (restaurant_id) where status = 'open';

-- ---------------------------------------------------------------
-- 2 · Entradas y salidas que no son ventas
-- ---------------------------------------------------------------
create table if not exists public.cash_movements (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.cash_sessions(id) on delete cascade,
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,

  kind           cash_movement_kind not null,
  -- Positivo entra en el cajón, negativo sale. El signo lo impone un
  -- disparador a partir del tipo, para que no puedan discrepar.
  amount_cents   integer not null check (amount_cents <> 0),
  method         payment_method not null default 'cash',

  reason         text not null,
  courier_id     uuid references public.couriers(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists cash_movements_session_idx on public.cash_movements (session_id, created_at);

/** Los tipos que sacan dinero del cajón llevan signo negativo siempre. */
create or replace function public.sign_cash_movement()
returns trigger language plpgsql as $$
begin
  new.amount_cents := case
    when new.kind in ('payout', 'withdrawal', 'tip_out') then -abs(new.amount_cents)
    when new.kind in ('deposit', 'courier_settlement')   then  abs(new.amount_cents)
    else new.amount_cents   -- 'correction' y 'other' admiten los dos sentidos
  end;
  return new;
end $$;

drop trigger if exists cash_movements_sign on public.cash_movements;
create trigger cash_movements_sign
  before insert or update on public.cash_movements
  for each row execute function public.sign_cash_movement();

-- ---------------------------------------------------------------
-- 3 · Cada cobro sabe a qué turno pertenece
--
-- Es lo que permite cerrar la caja de las tres de la tarde sin arrastrar los
-- cobros de la noche. Si no hay turno abierto el apunte se queda sin él: un
-- local que no usa la caja no tiene por qué verse obligado a abrirla para
-- poder cobrar.
-- ---------------------------------------------------------------
alter table public.order_payments
  add column if not exists cash_session_id uuid references public.cash_sessions(id) on delete set null;

create index if not exists order_payments_session_idx
  on public.order_payments (cash_session_id) where cash_session_id is not null;

create or replace function public.open_session_of(p_restaurant_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.cash_sessions
   where restaurant_id = p_restaurant_id and status = 'open'
   limit 1;
$$;

create or replace function public.stamp_payment_session()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cash_session_id is null then
    new.cash_session_id := public.open_session_of(new.restaurant_id);
  end if;
  return new;
end $$;

drop trigger if exists order_payments_session on public.order_payments;
create trigger order_payments_session
  before insert on public.order_payments
  for each row execute function public.stamp_payment_session();

-- ---------------------------------------------------------------
-- 4 · Abrir y cerrar
-- ---------------------------------------------------------------

/** Abre el turno declarando el fondo con el que se empieza. */
create or replace function public.open_cash_session(
  p_restaurant_id uuid,
  p_float_cents   integer default 0,
  p_note          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_charge(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CASH' using errcode = '42501';
  end if;

  if public.open_session_of(p_restaurant_id) is not null then
    raise exception 'SESSION_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  if p_float_cents < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  insert into public.cash_sessions (restaurant_id, opened_by, opening_float_cents, note)
  values (p_restaurant_id, auth.uid(), p_float_cents, nullif(btrim(coalesce(p_note,'')), ''))
  returning id into v_id;

  -- Los cobros hechos con la caja cerrada se recogen en el turno que abre: ese
  -- dinero está en el cajón igual, y dejarlo huérfano lo haría aparecer como
  -- descuadre.
  --
  -- Sólo los del hueco entre turnos, eso sí. Sin ese límite, la primera caja
  -- que se abriera se tragaría todo el histórico de cobros del local y saldría
  -- descuadrada por el importe de meses de ventas. Si no hay turno anterior no
  -- se adopta nada: lo que se cobró antes de existir la caja no estuvo nunca
  -- en este cajón.
  update public.order_payments
     set cash_session_id = v_id
   where restaurant_id = p_restaurant_id
     and cash_session_id is null
     and created_at >= (
       select max(closed_at) from public.cash_sessions
        where restaurant_id = p_restaurant_id and status = 'closed'
     );

  return jsonb_build_object('ok', true, 'session_id', v_id);
end;
$$;

/**
 * Efectivo que debería haber en el cajón de un turno.
 *
 * El efectivo cobrado por un repartidor no entra aquí: está en su bolsillo,
 * no en el cajón. Sólo cuenta cuando lo liquida, y entonces entra como
 * movimiento. Sin esta distinción, toda caja con reparto saldría descuadrada.
 */
create or replace function public.expected_cash(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select opening_float_cents from public.cash_sessions where id = p_session_id), 0)
    + coalesce((select sum(amount_cents) from public.order_payments
                 where cash_session_id = p_session_id
                   and method = 'cash'
                   and courier_id is null), 0)
    + coalesce((select sum(amount_cents) from public.cash_movements
                 where session_id = p_session_id and method = 'cash'), 0);
$$;

/**
 * Cierra el turno con el recuento a mano.
 *
 * El descuadre se calcula y se guarda tal cual sale, sin redondear ni
 * esconder: una caja que descuadra siempre por poco es información, y taparla
 * es justo lo que impide detectar un problema.
 */
create or replace function public.close_cash_session(
  p_session_id    uuid,
  p_counted_cents integer,
  p_note          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion   public.cash_sessions;
  v_esperado int;
begin
  select * into v_sesion from public.cash_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_charge(v_sesion.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CASH' using errcode = '42501';
  end if;

  if v_sesion.status = 'closed' then
    raise exception 'SESSION_ALREADY_CLOSED' using errcode = 'P0001';
  end if;

  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'COUNT_REQUIRED' using errcode = 'P0001';
  end if;

  v_esperado := public.expected_cash(p_session_id);

  update public.cash_sessions
     set status = 'closed',
         closed_at = now(),
         closed_by = auth.uid(),
         counted_cents = p_counted_cents,
         expected_cents = v_esperado,
         variance_cents = p_counted_cents - v_esperado,
         note = coalesce(nullif(btrim(coalesce(p_note,'')), ''), note)
   where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'expected_cents', v_esperado,
    'counted_cents', p_counted_cents,
    'variance_cents', p_counted_cents - v_esperado
  );
end;
$$;

/** Entrada o salida de efectivo que no es una venta. */
create or replace function public.add_cash_movement(
  p_restaurant_id uuid,
  p_kind          cash_movement_kind,
  p_amount_cents  integer,
  p_reason        text,
  p_method        payment_method default 'cash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion uuid;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_charge(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CASH' using errcode = '42501';
  end if;

  if v_motivo is null then
    raise exception 'MOVEMENT_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_amount_cents = 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  v_sesion := public.open_session_of(p_restaurant_id);
  if v_sesion is null then
    -- Sacar dinero de un cajón que nadie ha abierto no se puede cuadrar
    -- después: el movimiento no tendría turno al que pertenecer.
    raise exception 'NO_OPEN_SESSION' using errcode = 'P0001';
  end if;

  insert into public.cash_movements (
    session_id, restaurant_id, kind, amount_cents, method, reason, created_by
  ) values (
    v_sesion, p_restaurant_id, p_kind, p_amount_cents, p_method, v_motivo, auth.uid()
  );

  return jsonb_build_object('ok', true, 'session_id', v_sesion);
end;
$$;

-- ---------------------------------------------------------------
-- 5 · La liquidación del repartidor entra en la caja
--
-- Antes sólo sellaba los apuntes y no dejaba recibo: si al día siguiente había
-- discusión sobre cuánto se entregó, no quedaba más que marcas sueltas en
-- pedidos individuales. Ahora el sobre entra en el cajón como un movimiento,
-- con importe, fecha y quién lo recibió.
-- ---------------------------------------------------------------
create or replace function public.settle_courier_cash(
  p_courier_id    uuid,
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedidos int;
  v_cents   int;
  v_sesion  uuid;
  v_nombre  text;
begin
  if not public.can_charge(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_SETTLE' using errcode = '42501';
  end if;

  select count(distinct order_id)::int, coalesce(sum(amount_cents), 0)::int
    into v_pedidos, v_cents
    from public.order_payments
   where restaurant_id = p_restaurant_id and courier_id = p_courier_id
     and method = 'cash' and kind = 'charge' and cash_settled_at is null;

  if v_cents <= 0 then
    return jsonb_build_object('ok', true, 'orders', 0, 'cents', 0);
  end if;

  update public.order_payments
     set cash_settled_at = now(), cash_settled_by = auth.uid()
   where restaurant_id = p_restaurant_id and courier_id = p_courier_id
     and method = 'cash' and kind = 'charge' and cash_settled_at is null;

  -- El recibo. Si no hay caja abierta el dinero se entrega igual —no se le va
  -- a decir al repartidor que vuelva luego— pero queda sin turno, y aparecerá
  -- en el siguiente al abrirlo.
  v_sesion := public.open_session_of(p_restaurant_id);
  if v_sesion is not null then
    select coalesce(pr.full_name, pr.email, '—') into v_nombre
      from public.couriers c join public.profiles pr on pr.id = c.user_id
     where c.id = p_courier_id;

    insert into public.cash_movements (
      session_id, restaurant_id, kind, amount_cents, method, reason, courier_id, created_by
    ) values (
      v_sesion, p_restaurant_id, 'courier_settlement', v_cents, 'cash',
      format('Efectivo de %s · %s pedidos', coalesce(v_nombre, '—'), v_pedidos),
      p_courier_id, auth.uid()
    );
  end if;

  return jsonb_build_object('ok', true, 'orders', v_pedidos, 'cents', v_cents,
                            'session_id', v_sesion);
end;
$$;

-- ---------------------------------------------------------------
-- 6 · El informe Z
--
-- Lo que se mira al cerrar: qué entró, por qué medio, quién lo cobró, cuánto
-- se devolvió, cuánto se invitó, y si el cajón cuadra.
-- ---------------------------------------------------------------
create or replace function public.cash_session_report(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (select * from public.cash_sessions where id = p_session_id),
  apuntes as (select p.* from public.order_payments p where p.cash_session_id = p_session_id),
  movs as (select m.* from public.cash_movements m where m.session_id = p_session_id),
  pedidos as (
    select distinct o.* from public.orders o
    join apuntes a on a.order_id = o.id
  )
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'status', s.status,
      'opened_at', s.opened_at,
      'opened_by', (select coalesce(full_name, email) from public.profiles where id = s.opened_by),
      'opening_float_cents', s.opening_float_cents,
      'closed_at', s.closed_at,
      'closed_by', (select coalesce(full_name, email) from public.profiles where id = s.closed_by),
      'counted_cents', s.counted_cents,
      'expected_cents', coalesce(s.expected_cents, public.expected_cash(p_session_id)),
      'variance_cents', s.variance_cents,
      'note', s.note),

    -- Caja del turno: cobros menos devoluciones, por medio de pago.
    'collected_cents', coalesce((select sum(amount_cents) from apuntes), 0),
    'charges_cents',   coalesce((select sum(amount_cents) from apuntes where kind = 'charge'), 0),
    'refunds_cents',   coalesce((select sum(-amount_cents) from apuntes where kind = 'refund'), 0),
    'orders', (select count(*) from pedidos),
    'tips_cents', coalesce((select sum(tip_cents) from pedidos), 0),

    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', x.method, 'charges', x.cobros, 'charged_cents', x.cargado,
        'refunded_cents', x.devuelto, 'net_cents', x.cargado - x.devuelto) order by x.method)
      from (
        select method,
               count(*) filter (where kind = 'charge')::int as cobros,
               coalesce(sum(amount_cents) filter (where kind = 'charge'), 0)::int as cargado,
               coalesce(sum(-amount_cents) filter (where kind = 'refund'), 0)::int as devuelto
        from apuntes group by method
      ) x), '[]'::jsonb),

    -- Quién cobró qué. Es lo que convierte un descuadre en una conversación
    -- concreta en vez de una sospecha general.
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(pr.full_name, pr.email, '—'),
        'charges', x.cobros, 'cents', x.cents) order by x.cents desc)
      from (
        select created_by, count(*)::int as cobros, coalesce(sum(amount_cents), 0)::int as cents
        from apuntes where created_by is not null group by created_by
      ) x
      left join public.profiles pr on pr.id = x.created_by), '[]'::jsonb),

    -- Efectivo que anda por la calle: cobrado por repartidores y sin liquidar.
    'courier_cash_cents', coalesce((
      select sum(amount_cents) from apuntes
      where method = 'cash' and courier_id is not null and cash_settled_at is null), 0),

    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'amount_cents', m.amount_cents,
        'method', m.method, 'reason', m.reason, 'created_at', m.created_at,
        'by', (select coalesce(full_name, email) from public.profiles where id = m.created_by))
        order by m.created_at)
      from movs m), '[]'::jsonb),
    'movements_in_cents',  coalesce((select sum(amount_cents) from movs where amount_cents > 0), 0),
    'movements_out_cents', coalesce((select sum(-amount_cents) from movs where amount_cents < 0), 0),

    -- Lo que se dejó de cobrar y por qué: invitaciones y anulaciones del turno.
    'discounts_cents', coalesce((select sum(manual_discount_cents) from pedidos), 0),
    'voided_items', coalesce((
      select count(*) from public.order_items i
      join pedidos o on o.id = i.order_id
      where i.voided_at is not null), 0),
    'cancelled_orders', coalesce((
      select count(*) from public.orders o
      where o.restaurant_id = s.restaurant_id
        and o.status = 'cancelled'
        and o.cancelled_at >= s.opened_at
        and o.cancelled_at < coalesce(s.closed_at, now())), 0)
  )
  from s
  where public.is_staff_of(s.restaurant_id) or public.is_superadmin();
$$;

/** El turno abierto del local con su resumen, para la pantalla de caja. */
create or replace function public.current_cash_session(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.open_session_of(p_restaurant_id) is null then null
    else public.cash_session_report(public.open_session_of(p_restaurant_id))
  end
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

/** Historial de turnos cerrados. */
create or replace function public.cash_sessions_list(
  p_restaurant_id uuid,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'status', s.status,
    'opened_at', s.opened_at,
    'closed_at', s.closed_at,
    'opened_by', (select coalesce(full_name, email) from public.profiles where id = s.opened_by),
    'closed_by', (select coalesce(full_name, email) from public.profiles where id = s.closed_by),
    'opening_float_cents', s.opening_float_cents,
    'counted_cents', s.counted_cents,
    'expected_cents', s.expected_cents,
    'variance_cents', s.variance_cents,
    'collected_cents', coalesce((select sum(amount_cents) from public.order_payments p
                                  where p.cash_session_id = s.id), 0)
  ) order by s.opened_at desc), '[]'::jsonb)
  from (
    select * from public.cash_sessions
     where restaurant_id = p_restaurant_id
     order by opened_at desc
     limit greatest(p_limit, 1)
  ) s
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

-- ---------------------------------------------------------------
-- 7 · Acceso
--
-- Se lee; se escribe sólo por las funciones de arriba, que comprueban el
-- permiso. Un turno cerrado no se puede reabrir ni retocar: eso es justo lo
-- que un arqueo tiene que impedir.
-- ---------------------------------------------------------------
alter table public.cash_sessions  enable row level security;
alter table public.cash_sessions  force row level security;
alter table public.cash_movements enable row level security;
alter table public.cash_movements force row level security;

drop policy if exists cash_sessions_read on public.cash_sessions;
create policy cash_sessions_read on public.cash_sessions
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());

drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());

grant select on public.cash_sessions, public.cash_movements to authenticated;

grant execute on function public.open_cash_session(uuid, integer, text) to authenticated;
grant execute on function public.close_cash_session(uuid, integer, text) to authenticated;
grant execute on function public.add_cash_movement(uuid, cash_movement_kind, integer, text, payment_method) to authenticated;
grant execute on function public.cash_session_report(uuid) to authenticated;
grant execute on function public.current_cash_session(uuid) to authenticated;
grant execute on function public.cash_sessions_list(uuid, integer) to authenticated;
grant execute on function public.expected_cash(uuid) to authenticated;
grant execute on function public.open_session_of(uuid) to authenticated;
grant execute on function public.settle_courier_cash(uuid, uuid) to authenticated;
