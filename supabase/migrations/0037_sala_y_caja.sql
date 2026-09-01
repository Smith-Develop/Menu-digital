-- =============================================================
--  Fase 1 · lo que el libro de movimientos cambia río abajo
--
--  Al pasar los cobros a apuntes propios, dos consultas se quedaron mirando
--  al sitio equivocado: la sala seguía diciendo el total de la mesa en vez de
--  lo que falta por cobrar, y el efectivo del repartidor se leía de una
--  columna del pedido que ya no es la fuente.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · La sala enseña lo que falta, no lo que se pidió
--
-- Con la cuenta dividida, "esta mesa debe 60" deja de ser cierto en cuanto uno
-- de los comensales paga su parte. Lo que el camarero necesita ver es lo que
-- queda por cobrar.
-- ---------------------------------------------------------------
create or replace function public.floor_status(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'code', t.code,
      'seats', t.seats,
      'waiter_id', t.assigned_waiter_id,
      'waiter_name', p.full_name,
      'assigned_at', t.assigned_at,
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'code', o.code,
          'status', o.status,
          'payment_status', o.payment_status,
          'total_cents', o.total_cents,
          'paid_cents', o.paid_cents,
          'created_at', o.created_at) order by o.created_at)
        from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), '[]'::jsonb),
      'total_cents', coalesce((
        select sum(o.total_cents) from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), 0),
      'due_cents', coalesce((
        select sum(greatest(o.total_cents - o.paid_cents, 0)) from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), 0),
      'pending_calls', coalesce((
        select count(*) from public.waiter_calls w
        where w.table_id = t.id and w.attended_at is null), 0)
    ) as x
    from public.tables t
    left join public.profiles p on p.id = t.assigned_waiter_id
    where t.restaurant_id = p_restaurant_id
      and t.is_active
  ) s
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.floor_status(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 2 · El efectivo en la calle, visto desde el local
--
-- El panel lo calculaba leyendo `orders.cash_settled_at`, que dejó de ser la
-- fuente: ahora la liquidación se sella en los apuntes. La diferencia importa
-- porque un pedido cobrado con datáfono ya no cuenta como dinero que el
-- repartidor tiene que traer, y antes sí contaba.
-- ---------------------------------------------------------------
create or replace function public.restaurant_cash_due(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'courier_id', x.courier_id,
    'name', coalesce(pr.full_name, pr.email, '—'),
    'orders', x.pedidos,
    'cents', x.cents
  ) order by coalesce(pr.full_name, pr.email)), '[]'::jsonb)
  from (
    select p.courier_id,
           count(distinct p.order_id)::int as pedidos,
           sum(p.amount_cents)::int as cents
    from public.order_payments p
    where p.restaurant_id = p_restaurant_id
      and p.method = 'cash'
      and p.kind = 'charge'
      and p.courier_id is not null
      and p.cash_settled_at is null
    group by p.courier_id
  ) x
  join public.couriers c on c.id = x.courier_id
  join public.profiles pr on pr.id = c.user_id
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.restaurant_cash_due(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 3 · Las métricas cuentan lo cobrado de verdad
--
-- `pending_cents` sumaba el total del pedido, que con la cuenta dividida deja
-- de ser lo que se debe: si un comensal ya puso su parte, sólo falta el resto.
-- Y la caja pasa a salir del libro de movimientos, que es donde viven las
-- devoluciones: una venta devuelta ya no puede seguir contando como ingreso.
-- ---------------------------------------------------------------
create or replace function public.restaurant_stats(p_restaurant_id uuid, p_days integer default 7)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders_today', (select count(*) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date and o.status <> 'cancelled'),

    'revenue_today_cents', (select coalesce(sum(o.total_cents),0) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date and o.status = 'completed'),

    -- Caja del día: los apuntes del día, cobros menos devoluciones.
    'collected_today_cents', (select coalesce(sum(p.amount_cents),0) from public.order_payments p
       where p.restaurant_id = p_restaurant_id and p.created_at::date = current_date),

    'pending_cents', (select coalesce(sum(greatest(o.total_cents - o.paid_cents, 0)),0) from public.orders o
       where o.restaurant_id = p_restaurant_id
         and o.status <> 'cancelled' and o.payment_status = 'pending'),
    'pending_orders', (select count(*) from public.orders o
       where o.restaurant_id = p_restaurant_id
         and o.status <> 'cancelled' and o.payment_status = 'pending'),

    'active_orders', (select count(*) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.status in ('pending','confirmed','preparing','ready','served','delivering')),
    'pending_calls', (select count(*) from public.waiter_calls c
       where c.restaurant_id = p_restaurant_id and c.status = 'pending'),

    'revenue_series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'cents', d.cents) order by d.day), '[]'::jsonb)
      from (
        select gs::date as day,
               coalesce((select sum(p.amount_cents) from public.order_payments p
                         where p.restaurant_id = p_restaurant_id
                           and p.created_at::date = gs::date), 0) as cents
        from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
      ) d),

    'top_products', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select i.name_snapshot as name, sum(i.quantity)::int as qty, sum(i.line_total_cents)::int as cents
        from public.order_items i
        join public.orders o on o.id = i.order_id
        where o.restaurant_id = p_restaurant_id
          and o.status <> 'cancelled'
          and i.voided_at is null
          and o.created_at > now() - make_interval(days => p_days)
        group by i.name_snapshot order by qty desc limit 5
      ) t)
  );
$$;

create or replace function public.restaurant_analytics(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with periodo as (
    select o.* from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.created_at >= p_from and o.created_at < p_to
      and o.status <> 'cancelled'
  ),
  cerrados as (select * from periodo where status = 'completed'),
  -- La caja sale de los apuntes y no de los pedidos: es lo que permite que una
  -- devolución reste de verdad en lugar de quedarse escondida.
  apuntes as (
    select p.* from public.order_payments p
    where p.restaurant_id = p_restaurant_id
      and p.created_at >= p_from and p.created_at < p_to
  )
  select jsonb_build_object(
    'orders', (select count(*) from periodo),
    'completed', (select count(*) from cerrados),

    'revenue_cents', (select coalesce(sum(total_cents), 0) from cerrados),
    'collected_cents', (select coalesce(sum(amount_cents), 0) from apuntes),
    'refunded_cents', (select coalesce(sum(-amount_cents), 0) from apuntes where kind = 'refund'),
    'pending_cents', (select coalesce(sum(greatest(total_cents - paid_cents, 0)), 0)
                        from periodo where payment_status = 'pending'),
    'pending_orders', (select count(*) from periodo where payment_status = 'pending'),
    'discounted_cents', (select coalesce(sum(manual_discount_cents), 0) from periodo),

    'avg_ticket_cents', (select coalesce(round(avg(total_cents)), 0)::int from cerrados),
    'units', (select coalesce(sum(i.quantity), 0)::int
              from cerrados c join public.order_items i on i.order_id = c.id
              where i.voided_at is null),

    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', t.type, 'orders', t.n, 'cents', t.cents))
      from (select type, count(*)::int as n, coalesce(sum(total_cents),0)::int as cents
            from cerrados group by type) t), '[]'::jsonb),

    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', m.metodo, 'orders', m.n, 'cents', m.cents))
      from (select method as metodo, count(*)::int as n, coalesce(sum(amount_cents),0)::int as cents
            from apuntes where kind = 'charge' group by method) m), '[]'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(x) from (
        select i.name_snapshot as name, i.image_snapshot as image,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from cerrados c join public.order_items i on i.order_id = c.id
        where i.voided_at is null
        group by i.name_snapshot, i.image_snapshot
        order by sum(i.quantity) desc limit 8
      ) x), '[]'::jsonb),

    'worst_products', coalesce((
      select jsonb_agg(x) from (
        select i.name_snapshot as name, i.image_snapshot as image,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from cerrados c join public.order_items i on i.order_id = c.id
        where i.voided_at is null
        group by i.name_snapshot, i.image_snapshot
        order by sum(i.quantity) asc limit 8
      ) x), '[]'::jsonb),

    'series', coalesce((
      select jsonb_agg(jsonb_build_object('i', d.i, 'cents', d.cents,
                                          'paid_cents', d.pagado, 'orders', d.n) order by d.i)
      from (
        select gs.i,
               coalesce((select sum(c.total_cents) from cerrados c
                         where c.created_at >= p_from + (gs.i || ' days')::interval
                           and c.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as cents,
               coalesce((select sum(a.amount_cents) from apuntes a
                         where a.created_at >= p_from + (gs.i || ' days')::interval
                           and a.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as pagado,
               coalesce((select count(*) from cerrados c
                         where c.created_at >= p_from + (gs.i || ' days')::interval
                           and c.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as n
        from generate_series(0, greatest(0, (extract(epoch from (p_to - p_from)) / 86400)::int - 1)) gs(i)
      ) d), '[]'::jsonb)
  )
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.restaurant_stats(uuid, integer) to authenticated;
grant execute on function public.restaurant_analytics(uuid, timestamptz, timestamptz) to authenticated;
