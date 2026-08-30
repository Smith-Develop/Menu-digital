-- La serie diaria agrupaba con `created_at::date = gs::date`. El cast de un
-- timestamptz a date lo resuelve Postgres en la zona de la sesión (UTC), pero el
-- rango llega como medianoche *local* del navegador. Con España en UTC+2 la
-- serie se desplazaba un día y dejaba fuera justo el día en curso, de modo que
-- las tarjetas (que comparan por instante) mostraban ingresos y el gráfico salía
-- plano.
--
-- Ahora los tramos se derivan del propio p_from con aritmética de intervalos, con
-- los mismos límites que usa `periodo`, así que serie y totales cuadran siempre y
-- en cualquier zona horaria. Cada punto se identifica por su índice de día; la
-- fecha visible la pone la aplicación, que ya conoce el rango en hora local.
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
  cerrados as (select * from periodo where status = 'completed')
  select jsonb_build_object(
    'orders', (select count(*) from periodo),
    'completed', (select count(*) from cerrados),
    'revenue_cents', (select coalesce(sum(total_cents), 0) from cerrados),
    'avg_ticket_cents', (select coalesce(round(avg(total_cents)), 0)::int from cerrados),
    'units', (select coalesce(sum(i.quantity), 0)::int
              from cerrados c join public.order_items i on i.order_id = c.id),

    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', t.type, 'orders', t.n, 'cents', t.cents))
      from (select type, count(*)::int as n, coalesce(sum(total_cents),0)::int as cents
            from cerrados group by type) t), '[]'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(x) from (
        select i.name_snapshot as name, i.image_snapshot as image,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from cerrados c join public.order_items i on i.order_id = c.id
        group by i.name_snapshot, i.image_snapshot
        order by sum(i.quantity) desc limit 8
      ) x), '[]'::jsonb),

    'worst_products', coalesce((
      select jsonb_agg(x) from (
        select i.name_snapshot as name, i.image_snapshot as image,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from cerrados c join public.order_items i on i.order_id = c.id
        group by i.name_snapshot, i.image_snapshot
        order by sum(i.quantity) asc limit 8
      ) x), '[]'::jsonb),

    'series', coalesce((
      select jsonb_agg(jsonb_build_object('i', d.i, 'cents', d.cents, 'orders', d.n) order by d.i)
      from (
        select gs.i,
               coalesce((select sum(c.total_cents) from cerrados c
                         where c.created_at >= p_from + (gs.i || ' days')::interval
                           and c.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as cents,
               coalesce((select count(*) from cerrados c
                         where c.created_at >= p_from + (gs.i || ' days')::interval
                           and c.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as n
        from generate_series(0, greatest(0, (extract(epoch from (p_to - p_from)) / 86400)::int - 1)) gs(i)
      ) d), '[]'::jsonb)
  )
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.restaurant_analytics(uuid, timestamptz, timestamptz) to authenticated;
