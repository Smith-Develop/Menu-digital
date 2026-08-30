-- =============================================================
--  Yumi · métricas de plataforma y de restaurante
--
--  Todo se calcula en una sola consulta por panel: pedir seis agregados desde
--  el servidor de la aplicación multiplicaría las idas y venidas a la base.
-- =============================================================

-- ---------------------------------------------------------------
-- Resumen de la plataforma para el superadministrador.
-- ---------------------------------------------------------------
create or replace function public.platform_stats(p_days integer default 30)
returns jsonb
language sql stable security definer set search_path = public as $$
  with periodo as (
    select o.*
    from public.orders o
    where o.created_at > now() - make_interval(days => greatest(p_days, 1))
      and o.status = 'completed'
  )
  select jsonb_build_object(
    'restaurants_total', (select count(*) from public.restaurants),
    'restaurants_active', (select count(*) from public.restaurants where is_active),
    'orders', (select count(*) from periodo),
    'revenue_cents', (select coalesce(sum(total_cents), 0) from periodo),
    'avg_ticket_cents', (select coalesce(round(avg(total_cents)), 0)::int from periodo),
    'couriers_total', (select count(*) from public.couriers where is_active),

    'top_restaurants', coalesce((
      select jsonb_agg(x) from (
        select r.name, r.slug, r.city, r.logo_url,
               count(p.id)::int as orders,
               coalesce(sum(p.total_cents), 0)::int as revenue_cents
        from periodo p
        join public.restaurants r on r.id = p.restaurant_id
        group by r.id, r.name, r.slug, r.city, r.logo_url
        order by sum(p.total_cents) desc nulls last
        limit 8
      ) x), '[]'::jsonb),

    'top_couriers', coalesce((
      select jsonb_agg(x) from (
        select coalesce(pr.full_name, pr.email, '—') as name,
               pr.avatar_url,
               c.vehicle,
               count(p.id)::int as deliveries
        from periodo p
        join public.couriers c on c.id = p.courier_id
        join public.profiles pr on pr.id = c.user_id
        group by c.id, pr.full_name, pr.email, pr.avatar_url, c.vehicle
        order by count(p.id) desc
        limit 8
      ) x), '[]'::jsonb),

    'top_cities', coalesce((
      select jsonb_agg(x) from (
        select r.city,
               count(p.id)::int as orders,
               coalesce(sum(p.total_cents), 0)::int as revenue_cents,
               count(distinct r.id)::int as restaurants
        from periodo p
        join public.restaurants r on r.id = p.restaurant_id
        where coalesce(btrim(r.city), '') <> ''
        group by r.city
        order by sum(p.total_cents) desc nulls last
        limit 8
      ) x), '[]'::jsonb),

    'top_categories', coalesce((
      select jsonb_agg(x) from (
        select cc.name, cc.slug,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from periodo p
        join public.order_items i on i.order_id = p.id
        join public.products pr on pr.id = i.product_id
        join public.catalog_categories cc on cc.id = pr.catalog_category_id
        group by cc.id, cc.name, cc.slug
        order by sum(i.quantity) desc
        limit 8
      ) x), '[]'::jsonb),

    'best_products', coalesce((
      select jsonb_agg(x) from (
        select i.name_snapshot as name, i.image_snapshot as image,
               r.name as restaurant,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from periodo p
        join public.order_items i on i.order_id = p.id
        join public.restaurants r on r.id = p.restaurant_id
        group by i.name_snapshot, i.image_snapshot, r.name
        order by sum(i.quantity) desc
        limit 8
      ) x), '[]'::jsonb),

    -- Lo que menos se vende, contando solo lo que se ha llegado a pedir:
    -- un plato con cero ventas no aparece en las líneas de pedido.
    'worst_products', coalesce((
      select jsonb_agg(x) from (
        select i.name_snapshot as name, i.image_snapshot as image,
               r.name as restaurant,
               sum(i.quantity)::int as units,
               coalesce(sum(i.line_total_cents), 0)::int as revenue_cents
        from periodo p
        join public.order_items i on i.order_id = p.id
        join public.restaurants r on r.id = p.restaurant_id
        group by i.name_snapshot, i.image_snapshot, r.name
        order by sum(i.quantity) asc
        limit 8
      ) x), '[]'::jsonb),

    -- Platos publicados que nadie ha pedido en el periodo.
    'never_ordered', coalesce((
      select jsonb_agg(x) from (
        select pr.name, pr.image_url as image, r.name as restaurant
        from public.products pr
        join public.restaurants r on r.id = pr.restaurant_id
        where pr.is_available
          and not exists (
            select 1 from periodo p
            join public.order_items i on i.order_id = p.id
            where i.product_id = pr.id
          )
        order by pr.created_at
        limit 8
      ) x), '[]'::jsonb),

    'revenue_series', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'cents', d.cents) order by d.day)
      from (
        select gs::date as day,
               coalesce((select sum(o.total_cents) from public.orders o
                         where o.status = 'completed' and o.created_at::date = gs::date), 0)::int as cents
        from generate_series(current_date - (greatest(p_days, 1) - 1), current_date, interval '1 day') gs
      ) d), '[]'::jsonb)
  )
  where public.is_superadmin();
$$;

grant execute on function public.platform_stats to authenticated;

-- ---------------------------------------------------------------
-- Métricas de un restaurante en un rango libre de fechas.
-- ---------------------------------------------------------------
create or replace function public.restaurant_analytics(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to   timestamptz
)
returns jsonb
language sql stable security definer set search_path = public as $$
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
      select jsonb_agg(jsonb_build_object('day', d.day, 'cents', d.cents, 'orders', d.n) order by d.day)
      from (
        select gs::date as day,
               coalesce((select sum(c.total_cents) from cerrados c where c.created_at::date = gs::date), 0)::int as cents,
               coalesce((select count(*) from cerrados c where c.created_at::date = gs::date), 0)::int as n
        from generate_series(p_from::date, (p_to - interval '1 day')::date, interval '1 day') gs
      ) d), '[]'::jsonb)
  )
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.restaurant_analytics to authenticated;
