-- =============================================================
--  La caja enseña todo lo que movió dinero en el turno
--
--  "Movimientos de caja" sólo listaba las entradas y salidas que no son venta
--  —pagos a proveedor, retiradas, el sobre del repartidor—, porque los cobros
--  viven en el libro de apuntes y no en esa tabla. El reparto de tablas es
--  correcto: una venta no es un movimiento de caja. Pero para quien cierra el
--  turno eso era invisible: un servicio con doscientos euros cobrados en
--  efectivo enseñaba "sin entradas ni salidas".
--
--  Las tablas siguen separadas; lo que cambia es que el informe las presenta
--  juntas y en orden, que es como se lee un arqueo.
-- =============================================================

/**
 * Movimientos del turno: cobros, devoluciones y entradas o salidas de caja.
 *
 * `in_drawer` es la distinción que hace que el arqueo cuadre. No todo lo
 * cobrado está en el cajón: lo de tarjeta va al banco y lo que cobró un
 * repartidor lo lleva él encima hasta que lo liquida. Sin marcarlo, la lista
 * sumaría más de lo que se va a contar al cerrar.
 */
create or replace function public.cash_session_entries(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'at'), '[]'::jsonb)
  from (
    -- Cobros y devoluciones de venta.
    select jsonb_build_object(
      'id', 'p:' || p.id,
      'at', p.created_at,
      'source', 'sale',
      'kind', p.kind,
      'amount_cents', p.amount_cents,
      'method', p.method,
      'order_code', o.code,
      'order_type', o.type,
      'label', p.note,
      'reason', p.reason,
      'by', coalesce(pr.full_name, pr.email, cpr.full_name, cpr.email),
      'by_courier', p.courier_id is not null,
      'in_drawer', p.method = 'cash' and p.courier_id is null
    ) as x
    from public.order_payments p
    join public.orders o on o.id = p.order_id
    left join public.profiles pr on pr.id = p.created_by
    left join public.couriers c on c.id = p.courier_id
    left join public.profiles cpr on cpr.id = c.user_id
    where p.cash_session_id = p_session_id

    union all

    -- Entradas y salidas que no son venta.
    select jsonb_build_object(
      'id', 'm:' || m.id,
      'at', m.created_at,
      'source', 'movement',
      'kind', m.kind,
      'amount_cents', m.amount_cents,
      'method', m.method,
      'order_code', null,
      'order_type', null,
      'label', m.reason,
      'reason', null,
      'by', coalesce(pr.full_name, pr.email),
      'by_courier', false,
      'in_drawer', m.method = 'cash'
    ) as x
    from public.cash_movements m
    left join public.profiles pr on pr.id = m.created_by
    where m.session_id = p_session_id
  ) s;
$$;

grant execute on function public.cash_session_entries(uuid) to authenticated;

-- El informe del turno pasa a devolver la lista unificada. Se conserva
-- `movements` con su significado de siempre —sólo las entradas y salidas— para
-- que nada de lo que ya lo lee cambie de sentido por debajo.
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

    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(pr.full_name, pr.email, '—'),
        'charges', x.cobros, 'cents', x.cents) order by x.cents desc)
      from (
        select created_by, count(*)::int as cobros, coalesce(sum(amount_cents), 0)::int as cents
        from apuntes where created_by is not null group by created_by
      ) x
      left join public.profiles pr on pr.id = x.created_by), '[]'::jsonb),

    'courier_cash_cents', coalesce((
      select sum(amount_cents) from apuntes
      where method = 'cash' and courier_id is not null and cash_settled_at is null), 0),

    -- Todo lo que movió dinero, en orden: es lo que se repasa al cerrar.
    'entries', public.cash_session_entries(p_session_id),

    'movements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'amount_cents', m.amount_cents,
        'method', m.method, 'reason', m.reason, 'created_at', m.created_at,
        'by', (select coalesce(full_name, email) from public.profiles where id = m.created_by))
        order by m.created_at)
      from movs m), '[]'::jsonb),
    'movements_in_cents',  coalesce((select sum(amount_cents) from movs where amount_cents > 0), 0),
    'movements_out_cents', coalesce((select sum(-amount_cents) from movs where amount_cents < 0), 0),

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

grant execute on function public.cash_session_report(uuid) to authenticated;
