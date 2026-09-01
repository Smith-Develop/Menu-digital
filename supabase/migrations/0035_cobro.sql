-- =============================================================
--  Fase 0 de la auditoría · cerrar el circuito del dinero
--
--  Hasta ahora el estado del pedido decidía por sí solo si había venta. Un
--  pedido de recogida, o uno de domicilio que repartía el propio local, podía
--  llegar a "completado" con el cobro en pendiente y desaparecía del panel sin
--  que nadie volviera a mirarlo. Además marcar cobrado no dejaba rastro: ni
--  hora, ni empleado, ni con qué se pagó realmente.
--
--  Esta migración separa por primera vez las dos cosas: el pedido sigue su
--  curso operativo, pero el cobro pasa a ser un hecho con autor y fecha, y
--  ningún pedido puede cerrarse sin él.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · El cobro deja huella
-- ---------------------------------------------------------------
alter table public.orders
  add column if not exists paid_at      timestamptz,
  add column if not exists paid_by      uuid references public.profiles(id) on delete set null,
  -- El medio con el que se cobró de verdad, que no siempre es el que se eligió
  -- al pedir: se encarga en efectivo y se paga con tarjeta en la puerta. Sin
  -- esta columna ese importe se le seguía reclamando al repartidor.
  add column if not exists paid_method  payment_method,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

create index if not exists orders_unpaid_idx
  on public.orders (restaurant_id, created_at desc)
  where payment_status = 'pending' and status <> 'cancelled';

-- Quién puede tocar el dinero. Se declara aquí, junto a las comprobaciones que
-- lo usan, y se refleja en `lib/auth-permissions.ts` para que la interfaz no
-- ofrezca botones que la base va a rechazar.
create or replace function public.can_charge(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_staff_role(rid, array['owner','admin','manager','cashier','waiter']::staff_role[]);
$$;

create or replace function public.can_cancel_orders(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_staff_role(rid, array['owner','admin','manager']::staff_role[]);
$$;

grant execute on function public.can_charge(uuid), public.can_cancel_orders(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 2 · La barrera: ningún pedido se cierra sin cobrar
--
-- Va en un disparador y no sólo en la aplicación porque las políticas de acceso
-- permiten a cualquier miembro del equipo escribir en `orders`: quien supiera
-- llamar a la API podía marcar cobrada una cuenta desde fuera del panel. Aquí
-- la regla se cumple venga la escritura de donde venga.
-- ---------------------------------------------------------------
create or replace function public.guard_order_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sin sesión de usuario es el propio servidor operando con la clave de
  -- servicio (avisos, mantenimiento, correcciones). No se le pone barrera:
  -- las comprobaciones de rol no tienen a quién comprobar.
  if auth.uid() is null then
    return new;
  end if;

  -- ---- Cobrar es una atribución, no un gesto cualquiera ----
  --
  -- El repartidor asignado también cobra, aunque no forme parte del equipo del
  -- local: el dinero cambia de manos en la puerta del cliente y él es quien
  -- está allí. Lo que recoge queda como deuda suya hasta que lo liquida.
  if new.payment_status is distinct from old.payment_status
     or new.paid_at is distinct from old.paid_at
     or new.paid_method is distinct from old.paid_method then
    if not public.can_charge(new.restaurant_id)
       and not public.is_superadmin()
       and (new.courier_id is null or new.courier_id is distinct from public.my_courier_id()) then
      raise exception 'FORBIDDEN_CHARGE' using errcode = '42501';
    end if;
  end if;

  -- ---- Liquidar el efectivo es cosa del local, nunca del repartidor ----
  --
  -- Dar por recibido el dinero es un segundo cobro, esta vez del repartidor a
  -- la caja del local, y sólo puede darlo por bueno quien lo cuenta. Aquí no
  -- vale la excepción de arriba: si valiera, el repartidor podría saldar su
  -- propia deuda sin entregar nada.
  if new.cash_settled_at is distinct from old.cash_settled_at then
    if not public.can_charge(new.restaurant_id) and not public.is_superadmin() then
      raise exception 'FORBIDDEN_SETTLE' using errcode = '42501';
    end if;
  end if;

  -- ---- Cerrar exige que el dinero esté dentro ----
  --
  -- Se comprueba sobre la fila que va a quedar, no sobre la anterior: quien
  -- cierra y cobra en la misma escritura —la entrega del repartidor— pasa sin
  -- tener que hacerlo en dos pasos.
  if new.status = 'completed' and old.status is distinct from 'completed'::order_status
     and new.payment_status <> 'paid' then
    raise exception 'PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- ---- Anular es una decisión de quien responde del local ----
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'::order_status then
    if not public.can_cancel_orders(new.restaurant_id) and not public.is_superadmin() then
      raise exception 'FORBIDDEN_CANCEL' using errcode = '42501';
    end if;
    if coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'CANCEL_REASON_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_money_guard on public.orders;
create trigger orders_money_guard
  before update on public.orders
  for each row execute function public.guard_order_money();

-- ---------------------------------------------------------------
-- 3 · Cobrar
--
-- Una sola puerta para registrar el cobro, que además anota el medio real.
-- Es idempotente: cobrar dos veces la misma cuenta no duplica nada ni falla,
-- porque en una barra dos personas pueden pulsar a la vez.
-- ---------------------------------------------------------------
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_method   payment_method default null
)
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

  if not public.can_charge(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CHARGE' using errcode = '42501';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true,
                              'cents', v_order.total_cents,
                              'method', v_order.paid_method);
  end if;

  update public.orders
     set payment_status = 'paid',
         paid_at        = now(),
         paid_by        = auth.uid(),
         paid_method    = coalesce(p_method, v_order.payment_method)
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'already', false,
                            'cents', v_order.total_cents,
                            'method', coalesce(p_method, v_order.payment_method));
end;
$$;

-- ---------------------------------------------------------------
-- 4 · Anular
--
-- Anular deja de ser un cambio de estado a secas. Exige motivo —sin él no hay
-- forma de distinguir un cliente que se arrepiente de una cocina saturada— y
-- devuelve el cupón: hasta ahora el canje se quedaba consumido por un pedido
-- que nunca existió, así que el cliente perdía su uso y los cupones limitados
-- se agotaban con ventas que no se produjeron.
-- ---------------------------------------------------------------
create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_freed   boolean := false;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_cancel_orders(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CANCEL' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already', true, 'coupon_freed', false);
  end if;

  -- Un pedido ya cobrado no se anula: eso es una devolución, que es otra
  -- operación y todavía no existe. Mejor negarse que dejar dinero cobrado
  -- colgando de una venta que dice no haber ocurrido.
  if v_order.payment_status = 'paid' then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  -- Se libera el canje antes de anular para que el cliente recupere su uso.
  if v_order.coupon_id is not null then
    delete from public.coupon_redemptions where order_id = p_order_id;
    if found then
      update public.coupons
         set redemptions_count = greatest(redemptions_count - 1, 0)
       where id = v_order.coupon_id;
      v_freed := true;
    end if;
  end if;

  update public.orders
     set status       = 'cancelled',
         cancel_reason = v_reason,
         cancelled_by  = auth.uid()
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'already', false, 'coupon_freed', v_freed);
end;
$$;

grant execute on function public.mark_order_paid(uuid, payment_method) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- 5 · La entrega del repartidor
--
-- Dos correcciones. La primera: no se comprobaba en qué estado venía el pedido,
-- así que uno todavía pendiente podía saltar de golpe a entregado y pagado sin
-- haber pasado por cocina. La segunda: sólo se registraba el cobro en efectivo,
-- de modo que si el repartidor llevaba datáfono no quedaba constancia de que
-- hubiera cobrado nada. Como hoy no existe el pago en línea, todo pedido que
-- se entrega se cobra en la puerta, sea cual sea el medio.
-- ---------------------------------------------------------------
create or replace function public.courier_deliver_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_user   uuid := auth.uid();
  v_cash   int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.courier_id is distinct from public.my_courier_id() then
    raise exception 'NOT_YOUR_ORDER' using errcode = '42501';
  end if;

  if v_order.status = 'completed' then
    raise exception 'ALREADY_DELIVERED' using errcode = 'P0001';
  end if;

  -- Se admite entregar desde "listo" además de desde "en reparto": si el local
  -- olvidó marcar la entrega en mano, el repartidor no puede quedarse atascado
  -- en la puerta del cliente. Lo que no se admite es entregar algo que la
  -- cocina no ha terminado.
  if v_order.status not in ('ready', 'delivering') then
    raise exception 'ORDER_NOT_READY' using errcode = 'P0001';
  end if;

  v_cash := case when v_order.payment_method = 'cash'
                  and v_order.payment_status <> 'paid'
            then v_order.total_cents else 0 end;

  update public.orders
     set status       = 'completed',
         completed_at = coalesce(completed_at, now()),
         picked_up_at = coalesce(picked_up_at, now()),
         payment_status = 'paid',
         -- Sólo se sella el cobro si no venía ya pagado de antes.
         paid_at      = coalesce(paid_at, now()),
         paid_by      = coalesce(paid_by, v_user),
         paid_method  = coalesce(paid_method, v_order.payment_method)
   where id = p_order_id;

  update public.couriers
     set deliveries_count = deliveries_count + 1,
         status = case
           when exists (select 1 from public.orders
                        where courier_id = v_order.courier_id and status = 'delivering')
           then 'busy'::courier_status else 'available'::courier_status
         end
   where id = v_order.courier_id;

  return jsonb_build_object('ok', true, 'cash_cents', v_cash);
end;
$$;

-- Sustituida por courier_deliver_order, que además registra el cobro. Se
-- retira en lugar de dejarla ahí: cerraba pedidos sin mirar el dinero.
drop function if exists public.courier_complete_order(uuid);

-- ---------------------------------------------------------------
-- 6 · La liquidación del efectivo
--
-- Resolvía el restaurante tomando la primera fila de equipo del usuario con un
-- `limit 1` sin ordenar. Quien trabaja en dos locales de la plataforma liquidaba
-- en el que devolviera la base primero, que puede no ser en el que está: el
-- dinero se daba por recibido en la caja equivocada. Ahora el local se indica
-- explícitamente y se comprueba que quien liquida trabaja allí.
-- ---------------------------------------------------------------
drop function if exists public.settle_courier_cash(uuid);

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
  v_orders int;
  v_cents  int;
begin
  if not public.can_charge(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select count(*)::int, coalesce(sum(total_cents), 0)::int
    into v_orders, v_cents
    from public.orders
   where restaurant_id = p_restaurant_id
     and courier_id = p_courier_id
     and payment_method = 'cash'
     and status = 'completed'
     and cash_settled_at is null;

  update public.orders
     set cash_settled_at = now(),
         cash_settled_by = auth.uid()
   where restaurant_id = p_restaurant_id
     and courier_id = p_courier_id
     and payment_method = 'cash'
     and status = 'completed'
     and cash_settled_at is null;

  return jsonb_build_object('ok', true, 'orders', v_orders, 'cents', v_cents);
end;
$$;

grant execute on function public.settle_courier_cash(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------
-- 7 · La sesión de mesa se comprueba al crear el pedido
--
-- La validación del turno vivía sólo en la aplicación, mientras que la función
-- aceptaba cualquier código de mesa activa. Quien guardara la dirección de la
-- mesa 7 podía añadir comandas a la cuenta de quien estuviera sentado en ese
-- momento, desde cualquier sitio. La regla pasa a estar donde se crea el
-- pedido, que es el único punto por el que no se puede pasar de largo.
-- ---------------------------------------------------------------
drop function if exists public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text, text, integer, text);

create or replace function public.place_order(
  p_restaurant_slug text,
  p_items           jsonb,
  p_type            order_type,
  p_payment_method  payment_method,
  p_table_code      text default null,
  p_customer_name   text default null,
  p_customer_phone  text default null,
  p_customer_email  text default null,
  p_address         text default null,
  p_address_notes   text default null,
  p_notes           text default null,
  p_tip_cents       integer default 0,
  p_coupon_code     text default null,
  p_table_session   uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rest      public.restaurants%rowtype;
  v_coupon    public.coupons%rowtype;
  v_table_id  uuid;
  v_order_id  uuid;
  v_token     uuid;
  v_code      text;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_opts      jsonb;
  v_opt_total integer;
  v_line      integer;
  v_priced    jsonb := '[]'::jsonb;
  v_subtotal  integer := 0;
  v_delivery  integer := 0;
  v_tax       integer := 0;
  v_discount  integer := 0;
  v_total     integer := 0;
  v_used      integer;
begin
  select * into v_rest from public.restaurants where slug = p_restaurant_slug and is_active;
  if not found then raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.restaurant_is_live(v_rest.id) then
    raise exception 'RESTAURANT_SUBSCRIPTION_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_rest.is_open then raise exception 'RESTAURANT_CLOSED' using errcode = 'P0001'; end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;

  if p_type = 'delivery' and not v_rest.delivery_enabled then raise exception 'DELIVERY_DISABLED' using errcode='P0001'; end if;
  if p_type = 'pickup'   and not v_rest.pickup_enabled   then raise exception 'PICKUP_DISABLED'   using errcode='P0001'; end if;
  if p_type = 'dine_in'  and not v_rest.dinein_enabled   then raise exception 'DINEIN_DISABLED'   using errcode='P0001'; end if;
  if p_payment_method = 'cash' and not v_rest.accepts_cash then raise exception 'PAYMENT_METHOD_DISABLED' using errcode='P0001'; end if;
  if p_payment_method = 'card' and not v_rest.accepts_card then raise exception 'PAYMENT_METHOD_DISABLED' using errcode='P0001'; end if;
  if p_payment_method = 'tpv'  and not v_rest.accepts_tpv  then raise exception 'PAYMENT_METHOD_DISABLED' using errcode='P0001'; end if;

  if p_type = 'dine_in' then
    if p_table_code is null then raise exception 'TABLE_REQUIRED' using errcode = 'P0001'; end if;

    select id into v_table_id from public.tables
      where code = p_table_code and restaurant_id = v_rest.id and is_active
        -- El turno tiene que coincidir con el que traía el navegador al
        -- escanear. Quien pide desde el equipo del local no arrastra turno, y
        -- por eso el camarero puede seguir levantando comandas sin QR.
        and (
          session_id = p_table_session
          or (p_table_session is null and public.is_staff_of(v_rest.id))
        );

    if v_table_id is null then raise exception 'TABLE_SESSION_EXPIRED' using errcode = 'P0001'; end if;
  end if;

  if p_type = 'delivery' and coalesce(btrim(p_address), '') = '' then
    raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001';
  end if;

  v_code  := public.next_order_code();
  v_token := gen_random_uuid();

  insert into public.orders (
    restaurant_id, table_id, customer_id, public_token, code, type, status,
    customer_name, customer_phone, customer_email, address, address_notes,
    payment_method, currency, notes, tip_cents
  ) values (
    v_rest.id, v_table_id, auth.uid(), v_token, v_code, p_type, 'pending',
    p_customer_name, p_customer_phone, p_customer_email, p_address, p_address_notes,
    p_payment_method, v_rest.currency, p_notes, greatest(coalesce(p_tip_cents,0), 0)
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid
        and restaurant_id = v_rest.id
        and is_available;
    if not found then raise exception 'PRODUCT_UNAVAILABLE:%', v_item->>'product_id' using errcode = 'P0002'; end if;

    v_qty := greatest(coalesce((v_item->>'quantity')::int, 1), 1);

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', o.id, 'group', g.name, 'name', o.name,
             'price_delta_cents', o.price_delta_cents)), '[]'::jsonb),
           coalesce(sum(o.price_delta_cents), 0)
      into v_opts, v_opt_total
      from public.options o
      join public.option_groups g on g.id = o.group_id
     where g.product_id = v_product.id
       and o.is_available
       and o.id in (
         select (jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb)))::uuid
       );

    v_line := (v_product.price_cents + v_opt_total) * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_priced := v_priced || jsonb_build_object(
      'product_id', v_product.id, 'quantity', v_qty, 'unit_total_cents', v_line);

    insert into public.order_items (
      order_id, product_id, name_snapshot, image_snapshot, unit_price_cents,
      quantity, options, options_total_cents, line_total_cents, notes
    ) values (
      v_order_id, v_product.id, v_product.name, v_product.image_url, v_product.price_cents,
      v_qty, v_opts, v_opt_total, v_line, nullif(btrim(coalesce(v_item->>'notes','')), '')
    );
  end loop;

  if p_type = 'delivery' then
    if v_subtotal < v_rest.min_order_cents then
      raise exception 'MIN_ORDER_NOT_REACHED:%', v_rest.min_order_cents using errcode = 'P0001';
    end if;
    v_delivery := v_rest.delivery_fee_cents;
  end if;

  -- ---------- Cupón ----------
  if coalesce(btrim(p_coupon_code), '') <> '' then
    v_coupon := public.find_coupon(p_coupon_code, v_rest.id);

    if v_coupon.id is null then raise exception 'COUPON_NOT_FOUND' using errcode = 'P0002'; end if;
    if not v_coupon.is_active then raise exception 'COUPON_INACTIVE' using errcode = 'P0001'; end if;
    if v_coupon.starts_at > now() then raise exception 'COUPON_NOT_STARTED' using errcode = 'P0001'; end if;
    if v_coupon.ends_at is not null and v_coupon.ends_at < now() then
      raise exception 'COUPON_EXPIRED' using errcode = 'P0001';
    end if;
    if v_subtotal < v_coupon.min_order_cents then
      raise exception 'COUPON_MIN_ORDER:%', v_coupon.min_order_cents using errcode = 'P0001';
    end if;

    select * into v_coupon from public.coupons where id = v_coupon.id for update;

    if v_coupon.max_redemptions is not null and v_coupon.redemptions_count >= v_coupon.max_redemptions then
      raise exception 'COUPON_EXHAUSTED' using errcode = 'P0001';
    end if;

    if auth.uid() is not null then
      select count(*) into v_used from public.coupon_redemptions
       where coupon_id = v_coupon.id and customer_id = auth.uid();
      if v_used >= v_coupon.max_per_customer then
        raise exception 'COUPON_ALREADY_USED' using errcode = 'P0001';
      end if;
    end if;

    v_discount := public.compute_coupon_discount(v_coupon, v_rest, v_priced, v_subtotal, v_delivery);
    if v_discount <= 0 then raise exception 'COUPON_NOT_APPLICABLE' using errcode = 'P0001'; end if;

    if v_coupon.kind = 'free_delivery' then
      v_delivery := greatest(v_delivery - v_discount, 0);
    end if;

    update public.coupons set redemptions_count = redemptions_count + 1 where id = v_coupon.id;

    insert into public.coupon_redemptions (coupon_id, order_id, restaurant_id, customer_id, discount_cents)
    values (v_coupon.id, v_order_id, v_rest.id, auth.uid(), v_discount);

    update public.orders
       set coupon_id = v_coupon.id, coupon_code = upper(v_coupon.code)
     where id = v_order_id;
  end if;

  v_tax := round(greatest(v_subtotal - (case when v_coupon.kind = 'free_delivery' then 0 else v_discount end), 0)
                 * v_rest.tax_rate)::int;

  v_total := greatest(
    v_subtotal
      - (case when v_coupon.kind = 'free_delivery' then 0 else v_discount end)
      + v_delivery + v_tax + greatest(coalesce(p_tip_cents,0),0),
    0);

  update public.orders
     set subtotal_cents = v_subtotal,
         delivery_fee_cents = v_delivery,
         tax_cents = v_tax,
         discount_cents = case when v_coupon.kind = 'free_delivery' then 0 else v_discount end,
         total_cents = v_total
   where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id, 'code', v_code, 'token', v_token,
    'total_cents', v_total, 'discount_cents', v_discount, 'currency', v_rest.currency
  );
end $$;

grant execute on function public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text, text, integer, text, uuid
) to anon, authenticated;

-- ---------------------------------------------------------------
-- 8 · Las métricas dejan de confundir comida con dinero
--
-- Todos los agregados sumaban los pedidos en estado "completado" sin mirar si
-- estaban cobrados, así que la caja del día que enseñaba el panel no era
-- dinero: era comida entregada. Se mantiene esa cifra —es la venta, y sirve
-- para producción— pero al lado aparece lo realmente cobrado y lo que queda
-- pendiente, que es lo que permite ver el agujero.
-- ---------------------------------------------------------------
create or replace function public.restaurant_stats(p_restaurant_id uuid, p_days integer default 7)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders_today', (select count(*) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date and o.status <> 'cancelled'),

    -- Venta del día: lo entregado, cobrado o no.
    'revenue_today_cents', (select coalesce(sum(o.total_cents),0) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date and o.status = 'completed'),

    -- Caja del día: sólo lo que se ha cobrado de verdad.
    'collected_today_cents', (select coalesce(sum(o.total_cents),0) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date
         and o.payment_status = 'paid'),

    -- Lo que falta por cobrar, sin límite de fecha: un pedido de la semana
    -- pasada sin cobrar sigue siendo dinero que no ha entrado.
    'pending_cents', (select coalesce(sum(o.total_cents),0) from public.orders o
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
               coalesce((select sum(o.total_cents) from public.orders o
                         where o.restaurant_id = p_restaurant_id
                           and o.payment_status = 'paid'
                           and o.created_at::date = gs::date), 0) as cents
        from generate_series(current_date - (p_days - 1), current_date, interval '1 day') gs
      ) d),

    'top_products', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select i.name_snapshot as name, sum(i.quantity)::int as qty, sum(i.line_total_cents)::int as cents
        from public.order_items i
        join public.orders o on o.id = i.order_id
        where o.restaurant_id = p_restaurant_id
          and o.status <> 'cancelled'
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
  cobrados as (select * from periodo where payment_status = 'paid')
  select jsonb_build_object(
    'orders', (select count(*) from periodo),
    'completed', (select count(*) from cerrados),

    -- Venta entregada. Se conserva el nombre para no romper las pantallas que
    -- ya la leen, pero deja de ser la única cifra que se enseña.
    'revenue_cents', (select coalesce(sum(total_cents), 0) from cerrados),
    'collected_cents', (select coalesce(sum(total_cents), 0) from cobrados),
    'pending_cents', (select coalesce(sum(total_cents), 0) from periodo where payment_status = 'pending'),
    'pending_orders', (select count(*) from periodo where payment_status = 'pending'),

    'avg_ticket_cents', (select coalesce(round(avg(total_cents)), 0)::int from cerrados),
    'units', (select coalesce(sum(i.quantity), 0)::int
              from cerrados c join public.order_items i on i.order_id = c.id),

    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('type', t.type, 'orders', t.n, 'cents', t.cents))
      from (select type, count(*)::int as n, coalesce(sum(total_cents),0)::int as cents
            from cerrados group by type) t), '[]'::jsonb),

    -- Reparto de la caja por medio de pago realmente empleado. Es la base del
    -- futuro arqueo y, de momento, la primera forma de ver si lo que dice el
    -- cajón cuadra con lo que dice el sistema.
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', m.metodo, 'orders', m.n, 'cents', m.cents))
      from (select coalesce(paid_method, payment_method) as metodo,
                   count(*)::int as n, coalesce(sum(total_cents),0)::int as cents
            from cobrados group by 1) m), '[]'::jsonb),

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

    -- Cada punto lleva las dos cifras: la línea de venta y la de caja. Cuando
    -- se separan, ahí está el dinero que no ha entrado.
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('i', d.i, 'cents', d.cents,
                                          'paid_cents', d.pagado, 'orders', d.n) order by d.i)
      from (
        select gs.i,
               coalesce((select sum(c.total_cents) from cerrados c
                         where c.created_at >= p_from + (gs.i || ' days')::interval
                           and c.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as cents,
               coalesce((select sum(c.total_cents) from cobrados c
                         where c.created_at >= p_from + (gs.i || ' days')::interval
                           and c.created_at <  p_from + ((gs.i + 1) || ' days')::interval), 0)::int as pagado,
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
