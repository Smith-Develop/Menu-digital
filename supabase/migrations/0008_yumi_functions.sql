-- =============================================================
--  Yumi · ciudades, banners de portada y flujo de reparto
-- =============================================================

-- ---------------------------------------------------------------
-- Ciudades donde hay restaurantes servibles, con su recuento.
-- ---------------------------------------------------------------
create or replace function public.list_cities()
returns table (city text, city_slug text, restaurants integer)
language sql stable security definer set search_path = public as $$
  select r.city,
         r.city_slug,
         count(*)::int as restaurants
  from public.restaurants r
  where r.is_active
    and coalesce(btrim(r.city), '') <> ''
    and public.restaurant_is_live(r.id)
  group by r.city, r.city_slug
  order by count(*) desc, r.city;
$$;

-- ---------------------------------------------------------------
-- Ciudad más cercana a unas coordenadas.
--
-- Evita depender de un servicio de geocodificación externo: compara
-- contra la posición de los propios restaurantes con la fórmula del
-- haversine y devuelve la ciudad del más próximo.
-- ---------------------------------------------------------------
create or replace function public.nearest_city(p_lat double precision, p_lng double precision)
returns table (city text, city_slug text, distance_km double precision)
language sql stable security definer set search_path = public as $$
  select r.city,
         r.city_slug,
         min(
           6371 * 2 * asin(sqrt(
             power(sin(radians(r.lat - p_lat) / 2), 2) +
             cos(radians(p_lat)) * cos(radians(r.lat)) *
             power(sin(radians(r.lng - p_lng) / 2), 2)
           ))
         ) as distance_km
  from public.restaurants r
  where r.is_active
    and r.lat is not null and r.lng is not null
    and coalesce(btrim(r.city), '') <> ''
  group by r.city, r.city_slug
  order by distance_km
  limit 1;
$$;

-- ---------------------------------------------------------------
-- Banners de la portada: uno por restaurante como mucho, en orden
-- aleatorio, y solo de la ciudad del cliente.
-- ---------------------------------------------------------------
create or replace function public.home_banners(p_city_slug text default null, p_limit integer default 6)
returns table (
  id uuid, title text, subtitle text, image_url text, link_url text,
  restaurant_id uuid, restaurant_name text, restaurant_slug text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.subtitle, b.image_url, b.link_url,
         r.id, r.name, r.slug
  from (
    select distinct on (b.restaurant_id) b.*
    from public.banners b
    where b.is_active
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at >= now())
    order by b.restaurant_id, b.position, b.created_at desc
  ) b
  join public.restaurants r on r.id = b.restaurant_id
  where r.is_active
    and r.is_open
    and public.restaurant_is_live(r.id)
    and (p_city_slug is null or r.city_slug = p_city_slug)
  order by random()
  limit greatest(coalesce(p_limit, 6), 1);
$$;

-- ---------------------------------------------------------------
-- Notificaciones vigentes para una ciudad concreta.
-- ---------------------------------------------------------------
create or replace function public.active_notifications(p_city_slug text default null)
returns table (
  id uuid, title text, body text, image_url text, link_url text, link_label text
)
language sql stable security definer set search_path = public as $$
  select n.id, n.title, n.body, n.image_url, n.link_url, n.link_label
  from public.notifications n
  where n.is_active
    and n.starts_at <= now()
    and (n.ends_at is null or n.ends_at >= now())
    and (
      n.audience = 'all'
      or (p_city_slug is not null and p_city_slug = any(n.cities))
    )
  order by n.created_at desc
  limit 5;
$$;

-- ---------------------------------------------------------------
-- El repartidor toma un pedido disponible.
--
-- El UPDATE condicionado evita que dos repartidores se queden el mismo
-- pedido: solo gana quien lo encuentre todavía sin asignar.
-- ---------------------------------------------------------------
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

  update public.orders o
     set courier_id = v_courier,
         status = 'delivering'
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
-- El repartidor cierra la entrega.
-- ---------------------------------------------------------------
create or replace function public.courier_complete_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_courier uuid := public.my_courier_id();
  v_updated int;
begin
  if v_courier is null then
    raise exception 'NOT_A_COURIER' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'completed'
   where id = p_order_id and courier_id = v_courier and status = 'delivering';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'ORDER_NOT_ASSIGNED' using errcode = 'P0001';
  end if;

  update public.couriers
     set deliveries_count = deliveries_count + 1,
         status = case
           when exists (
             select 1 from public.orders
             where courier_id = v_courier and status = 'delivering'
           ) then 'busy'::courier_status
           else 'available'::courier_status
         end
   where id = v_courier;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------
-- Resumen del repartidor para su panel.
-- ---------------------------------------------------------------
create or replace function public.courier_stats()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'active', (
      select count(*) from public.orders
      where courier_id = public.my_courier_id() and status = 'delivering'),
    'today', (
      select count(*) from public.orders
      where courier_id = public.my_courier_id()
        and status = 'completed'
        and completed_at::date = current_date),
    'total', (
      select coalesce(deliveries_count, 0) from public.couriers
      where id = public.my_courier_id()),
    'restaurants', (
      select count(*) from public.restaurant_couriers
      where courier_id = public.my_courier_id() and is_active)
  );
$$;

-- ---------------------------------------------------------------
-- get_order_by_token amplía la respuesta con el repartidor asignado.
-- ---------------------------------------------------------------
create or replace function public.get_order_by_token(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'type', o.type,
    'status', o.status,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'currency', o.currency,
    'subtotal_cents', o.subtotal_cents,
    'delivery_fee_cents', o.delivery_fee_cents,
    'tax_cents', o.tax_cents,
    'tip_cents', o.tip_cents,
    'total_cents', o.total_cents,
    'notes', o.notes,
    'address', o.address,
    'created_at', o.created_at,
    'accepted_at', o.accepted_at,
    'ready_at', o.ready_at,
    'completed_at', o.completed_at,
    'restaurant', jsonb_build_object(
      'name', r.name, 'slug', r.slug, 'logo_url', r.logo_url,
      'phone', r.phone, 'address', r.address,
      'primary_color', r.primary_color,
      'currency_decimals', r.currency_decimals, 'avg_prep_minutes', r.avg_prep_minutes),
    'table', case when t.id is null then null else jsonb_build_object('name', t.name, 'code', t.code) end,
    'courier', case when c.id is null then null else jsonb_build_object(
      'name', p.full_name, 'phone', c.phone, 'vehicle', c.vehicle,
      'lat', c.lat, 'lng', c.lng) end,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot, 'image', i.image_snapshot, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents,
        'options', i.options, 'status', i.status, 'notes', i.notes) order by i.created_at), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'status', e.status, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
      from public.order_events e where e.order_id = o.id)
  )
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.tables t on t.id = o.table_id
  left join public.couriers c on c.id = o.courier_id
  left join public.profiles p on p.id = c.user_id
  where o.public_token = p_token;
$$;

grant execute on function public.list_cities, public.nearest_city,
  public.home_banners, public.active_notifications, public.get_order_by_token
  to anon, authenticated;
grant execute on function public.courier_take_order, public.courier_complete_order,
  public.courier_stats to authenticated;
