-- Recogida, entrega y liquidación del efectivo.
--
-- Faltaban dos piezas del reparto: dejar constancia de que el repartidor ya
-- tiene el pedido en la mano, y saber cuánto dinero en efectivo lleva encima
-- sin devolver al restaurante. Sin lo segundo, un pedido cobrado en la puerta
-- desaparecía del panel del local antes de que ese dinero llegara a la caja.
alter table public.orders
  add column if not exists cash_settled_at timestamptz,
  add column if not exists cash_settled_by uuid references public.profiles(id) on delete set null;

create index if not exists orders_cash_pending_idx
  on public.orders(restaurant_id, courier_id)
  where payment_method = 'cash' and cash_settled_at is null;

/**
 * El restaurante entrega el pedido al repartidor.
 *
 * Marca la recogida y pone el pedido en reparto de una vez: son el mismo gesto
 * —el repartidor sale por la puerta con la comida— y separarlos obligaba a
 * pulsar dos veces seguidas lo mismo.
 */
create or replace function public.courier_picked_up(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.is_staff_of(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_order.courier_id is null then
    raise exception 'NO_COURIER' using errcode = 'P0002';
  end if;

  update public.orders
     set status = 'delivering',
         picked_up_at = coalesce(picked_up_at, now())
   where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

/**
 * Entrega del pedido por el repartidor.
 *
 * Si se paga en efectivo, la entrega implica el cobro: el dinero cambia de
 * manos en la puerta. Ese importe queda pendiente de liquidar con el
 * restaurante, que es lo que mantiene el pedido a la vista del local hasta que
 * el dinero llega a su caja.
 */
create or replace function public.courier_deliver_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.courier_id is distinct from public.my_courier_id() then
    raise exception 'NOT_YOUR_ORDER' using errcode = '42501';
  end if;

  update public.orders
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         payment_status = case
           when v_order.payment_method = 'cash' then 'paid'
           else payment_status
         end
   where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'cash_cents', case when v_order.payment_method = 'cash' then v_order.total_cents else 0 end
  );
end;
$$;

/**
 * Efectivo que un repartidor debe al restaurante.
 *
 * Suma lo entregado y cobrado en mano que todavía no ha liquidado. Se agrupa
 * por restaurante porque un repartidor trabaja para varios y cada uno tiene su
 * propia caja.
 */
create or replace function public.courier_cash_due(p_courier_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'restaurant_id', r.id,
    'restaurant_name', r.name,
    'orders', x.pedidos,
    'cents', x.cents
  ) order by r.name), '[]'::jsonb)
  from (
    select o.restaurant_id, count(*)::int as pedidos, sum(o.total_cents)::int as cents
    from public.orders o
    where o.courier_id = coalesce(p_courier_id, public.my_courier_id())
      and o.payment_method = 'cash'
      and o.status = 'completed'
      and o.cash_settled_at is null
    group by o.restaurant_id
  ) x
  join public.restaurants r on r.id = x.restaurant_id;
$$;

/**
 * El restaurante da por recibido el efectivo de un repartidor.
 *
 * Liquida de golpe todo lo pendiente de ese repartidor en ese local: el dinero
 * se entrega en un sobre, no pedido a pedido.
 */
create or replace function public.settle_courier_cash(p_courier_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_total int;
begin
  select restaurant_id into v_restaurant
    from public.restaurant_staff
   where user_id = auth.uid() and is_active
   limit 1;

  if v_restaurant is null or not public.is_staff_of(v_restaurant) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.orders
     set cash_settled_at = now(),
         cash_settled_by = auth.uid()
   where restaurant_id = v_restaurant
     and courier_id = p_courier_id
     and payment_method = 'cash'
     and status = 'completed'
     and cash_settled_at is null;

  get diagnostics v_total = row_count;
  return jsonb_build_object('ok', true, 'orders', v_total);
end;
$$;

grant execute on function public.courier_picked_up(uuid) to authenticated;
grant execute on function public.courier_deliver_order(uuid) to authenticated;
grant execute on function public.courier_cash_due(uuid) to authenticated;
grant execute on function public.settle_courier_cash(uuid) to authenticated;
