-- =============================================================
--  Yumi · repartidores disponibles para asignar un pedido
-- =============================================================

-- ---------------------------------------------------------------
-- Repartidores del restaurante con su carga real.
--
-- La carga cuenta TODOS los repartos en curso del repartidor, también los de
-- otros restaurantes: como puede trabajar para varios a la vez, mirar solo los
-- propios daría una foto falsa de quién está libre.
-- ---------------------------------------------------------------
create or replace function public.restaurant_couriers_available(p_restaurant_id uuid)
returns table (
  courier_id      uuid,
  name            text,
  avatar_url      text,
  phone           text,
  vehicle         text,
  status          courier_status,
  active_here     integer,
  active_total    integer,
  deliveries      integer,
  rating          numeric
)
language sql stable security definer set search_path = public as $$
  select c.id,
         coalesce(p.full_name, p.email, '—'),
         p.avatar_url,
         c.phone,
         c.vehicle,
         c.status,
         (select count(*)::int from public.orders o
           where o.courier_id = c.id and o.status = 'delivering'
             and o.restaurant_id = p_restaurant_id),
         (select count(*)::int from public.orders o
           where o.courier_id = c.id and o.status = 'delivering'),
         c.deliveries_count,
         c.rating
  from public.restaurant_couriers rc
  join public.couriers c on c.id = rc.courier_id
  join public.profiles p on p.id = c.user_id
  where rc.restaurant_id = p_restaurant_id
    and rc.is_active
    and c.is_active
    and public.is_staff_of(p_restaurant_id)
  order by
    -- Primero quien está disponible y menos cargado.
    (c.status = 'available') desc,
    (select count(*) from public.orders o where o.courier_id = c.id and o.status = 'delivering'),
    p.full_name;
$$;

grant execute on function public.restaurant_couriers_available to authenticated;

-- ---------------------------------------------------------------
-- El restaurante asigna un pedido a uno de sus repartidores.
--
-- Un repartidor puede llevar varios pedidos a la vez, así que no se comprueba
-- que esté libre: se comprueba que sea del equipo y que el pedido esté listo.
-- ---------------------------------------------------------------
create or replace function public.assign_order_courier(p_order_id uuid, p_courier_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.is_staff_of(v_order.restaurant_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_order.type <> 'delivery' then
    raise exception 'NOT_A_DELIVERY' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.restaurant_couriers rc
    where rc.restaurant_id = v_order.restaurant_id
      and rc.courier_id = p_courier_id
      and rc.is_active
  ) then
    raise exception 'COURIER_NOT_IN_TEAM' using errcode = 'P0001';
  end if;

  update public.orders
     set courier_id = p_courier_id,
         status = case when status = 'ready' then 'delivering'::order_status else status end
   where id = p_order_id;

  update public.couriers set status = 'busy'
   where id = p_courier_id and status <> 'offline';

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.assign_order_courier to authenticated;
