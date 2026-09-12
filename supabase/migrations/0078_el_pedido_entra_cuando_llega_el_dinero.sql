-- =============================================================
--  El pedido entra en el local cuando llega el dinero
--
--  La migración 0077 creó el estado; aquí se le da efecto en los tres momentos
--  que lo tocan: al nacer el pedido, al confirmarse el cobro y cuando el cobro
--  no llega nunca.
--
--  El tercero es el que se olvida. Un pedido que no aparece en ningún panel
--  tampoco se cierra solo, y se quedaría ahí para siempre ocupando el hueco de
--  su franja de entrega. Se entierran tras dos horas sin ningún intento vivo:
--  suficiente para que alguien que se fue a buscar otra tarjeta vuelva.
-- =============================================================

-- Quién puede mover un pedido que espera el dinero. Se le da al encargado y
-- para arriba porque hay un caso real: el cliente llama, dice que no le pasa la
-- tarjeta, y el local decide aceptarlo contra reembolso.
insert into public.order_transitions (from_status, to_status, roles) values
  ('awaiting_payment', 'pending',   '{owner,admin,manager}'),
  ('awaiting_payment', 'cancelled', '{owner,admin,manager}')
on conflict (from_status, to_status) do update set roles = excluded.roles;

drop function if exists public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text,
  text, integer, text, uuid, integer, text, text, text, uuid, date, uuid);

CREATE OR REPLACE FUNCTION public.place_order(p_restaurant_slug text, p_items jsonb, p_type order_type, p_payment_method payment_method, p_table_code text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_address_notes text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_tip_cents integer DEFAULT 0, p_coupon_code text DEFAULT NULL::text, p_table_session uuid DEFAULT NULL::uuid, p_covers integer DEFAULT NULL::integer, p_billing_name text DEFAULT NULL::text, p_billing_tax_id text DEFAULT NULL::text, p_billing_address text DEFAULT NULL::text, p_slot_id uuid DEFAULT NULL::uuid, p_slot_date date DEFAULT NULL::date, p_address_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_discount  integer := 0;
  v_used      integer;
  v_order     public.orders;
  v_slot      public.delivery_slots;
  v_cuando    timestamptz;
  v_ocupadas  int;
  v_dir       public.customer_addresses%rowtype;
  v_address   text;
  v_snapshot  jsonb;
begin
  select * into v_rest from public.restaurants where slug = p_restaurant_slug and is_active;
  if not found then raise exception 'RESTAURANT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.restaurant_is_live(v_rest.id) then
    raise exception 'RESTAURANT_SUBSCRIPTION_INACTIVE' using errcode = 'P0001';
  end if;

  -- El horario, no sólo el interruptor. El equipo del local puede seguir
  -- levantando comandas fuera de hora: la cocina a veces trabaja con la
  -- persiana bajada y el pedido de teléfono entra igual.
  if not public.restaurant_is_open_now(v_rest.id) and not public.is_staff_of(v_rest.id) then
    raise exception 'RESTAURANT_CLOSED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;

  if p_type = 'delivery' and not public.delivery_allowed(v_rest.id) then
    raise exception 'DELIVERY_DISABLED' using errcode='P0001';
  end if;

  /*
   * Pago por adelantado a domicilio, cuando el local lo exige.
   *
   * El interruptor está en sus ajustes y la comprobación aquí, porque el
   * formulario no es el único camino: un pedido puede entrar por la API o por
   * una integración, y entonces la promesa de «aquí no se sirve sin pagar» se
   * rompe sin que nadie se entere.
   *
   * El equipo del local queda fuera a propósito: quien levanta el pedido por
   * teléfono cobra en el mostrador o en la puerta, y esa decisión es suya.
   */
  if p_type = 'delivery'
     and v_rest.prepay_delivery
     and p_payment_method <> 'online'
     and not public.is_staff_of(v_rest.id) then
    raise exception 'PREPAY_REQUIRED' using errcode = 'P0001';
  end if;
  if p_type = 'pickup'  and not v_rest.pickup_enabled then raise exception 'PICKUP_DISABLED' using errcode='P0001'; end if;
  if p_type = 'dine_in' and not v_rest.dinein_enabled then raise exception 'DINEIN_DISABLED' using errcode='P0001'; end if;
  if p_payment_method = 'cash' and not v_rest.accepts_cash then raise exception 'PAYMENT_METHOD_DISABLED' using errcode='P0001'; end if;
  if p_payment_method = 'card' and not v_rest.accepts_card then raise exception 'PAYMENT_METHOD_DISABLED' using errcode='P0001'; end if;
  if p_payment_method = 'tpv'  and not v_rest.accepts_tpv  then raise exception 'PAYMENT_METHOD_DISABLED' using errcode='P0001'; end if;

  if p_type = 'dine_in' then
    if p_table_code is null then raise exception 'TABLE_REQUIRED' using errcode = 'P0001'; end if;
    select id into v_table_id from public.tables
      where code = p_table_code and restaurant_id = v_rest.id and is_active
        and (
          session_id = p_table_session
          or (p_table_session is null and public.is_staff_of(v_rest.id))
        );
    if v_table_id is null then raise exception 'TABLE_SESSION_EXPIRED' using errcode = 'P0001'; end if;
  end if;

  -- La dirección de entrega, por dos caminos.
  --
  -- Hay dos formas legítimas de pedir a domicilio y no se parecen: el cliente
  -- desde su cuenta, que elige una ficha de su libreta, y el comercio por
  -- teléfono desde el TPV, cuyo cliente puede no tener cuenta y la dicta de
  -- viva voz. El primero llega validado de origen; el segundo hay que mirarlo.
  if p_type = 'delivery' then
    if p_address_id is not null then
      select * into v_dir from public.customer_addresses where id = p_address_id;
      if not found then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0002'; end if;

      -- Que la ficha sea suya. Sin esto, conocer un identificador ajeno
      -- bastaría para mandarle la cena a casa de otro y, peor, para leer en el
      -- propio pedido dónde vive esa persona.
      if v_dir.user_id is distinct from auth.uid() then
        raise exception 'ADDRESS_NOT_YOURS' using errcode = 'P0001';
      end if;

      v_address  := v_dir.full_line;
      v_snapshot := to_jsonb(v_dir);
    else
      v_address := btrim(coalesce(p_address, ''));
      if v_address = '' then
        raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001';
      end if;

      -- Por aquí se colaba «Dabeiba». El nombre de una ciudad dice a qué
      -- pueblo hay que ir, no a qué puerta llamar, y el repartidor se
      -- encontraba con eso delante.
      if not public.address_looks_complete(v_address) then
        raise exception 'ADDRESS_INCOMPLETE' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- La franja de entrega. El cupo se comprueba con la fila bloqueada: dos
  -- clientes pidiendo a la vez la última plaza de las seis de la tarde es
  -- exactamente el caso que hay que impedir, y sin el bloqueo los dos la
  -- consiguen.
  if p_slot_id is not null then
    if p_slot_date is null then
      raise exception 'SLOT_DATE_REQUIRED' using errcode = 'P0001';
    end if;

    select * into v_slot from public.delivery_slots
     where id = p_slot_id and restaurant_id = v_rest.id and is_active
     for update;
    if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;

    if extract(isodow from p_slot_date)::int <> v_slot.weekday then
      raise exception 'SLOT_WRONG_DAY' using errcode = 'P0001';
    end if;

    v_cuando := (p_slot_date + v_slot.starts_at) at time zone v_rest.timezone;

    if v_cuando < now() then
      raise exception 'SLOT_IN_THE_PAST' using errcode = 'P0001';
    end if;

    if v_slot.capacity > 0 then
      select count(*) into v_ocupadas from public.orders
       where delivery_slot_id = v_slot.id
         and scheduled_for = v_cuando
         and status <> 'cancelled';
      if v_ocupadas >= v_slot.capacity then
        raise exception 'SLOT_FULL' using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_code  := public.next_order_code_for(v_rest.id);
  v_token := gen_random_uuid();

  insert into public.orders (
    restaurant_id, table_id, customer_id, public_token, code, type, status,
    customer_name, customer_phone, customer_email, address, address_notes,
    address_id, address_snapshot,
    payment_method, currency, notes, tip_cents, covers, delivery_slot_id, scheduled_for,
    billing_name, billing_tax_id, billing_address
  ) values (
    v_rest.id, v_table_id, auth.uid(), v_token, v_code, p_type,
    -- Pagando por internet el pedido nace esperando el dinero, no esperando a
    -- la cocina. Los paneles filtran por estado, así que hasta que el cobro
    -- llega no aparece en ninguno: nadie se pone a cocinar algo que todavía
    -- puede quedarse sin pagar.
    case when p_payment_method = 'online' then 'awaiting_payment' else 'pending' end,
    p_customer_name, p_customer_phone, p_customer_email, v_address,
    -- Las referencias de la ficha valen como indicaciones si no dicta otras:
    -- el cliente ya escribió una vez «portón verde» y no tiene que repetirlo.
    coalesce(nullif(btrim(coalesce(p_address_notes, '')), ''), v_dir.notes),
    v_dir.id, v_snapshot,
    p_payment_method, v_rest.currency, p_notes, greatest(coalesce(p_tip_cents,0), 0),
    nullif(greatest(coalesce(p_covers, 0), 0), 0), v_slot.id, v_cuando,
    nullif(btrim(coalesce(p_billing_name,'')), ''),
    nullif(btrim(coalesce(p_billing_tax_id,'')), ''),
    nullif(btrim(coalesce(p_billing_address,'')), '')
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
      quantity, options, options_total_cents, line_total_cents, notes, tax_rate
    ) values (
      v_order_id, v_product.id, v_product.name, v_product.image_url, v_product.price_cents,
      v_qty, v_opts, v_opt_total, v_line, nullif(btrim(coalesce(v_item->>'notes','')), ''),
      coalesce(v_product.tax_rate, v_rest.tax_rate)
    );
  end loop;

  if p_type = 'delivery' then
    if v_subtotal < v_rest.min_order_cents then
      raise exception 'MIN_ORDER_NOT_REACHED:%', v_rest.min_order_cents using errcode = 'P0001';
    end if;
    v_delivery := v_rest.delivery_fee_cents;
  end if;

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

  update public.orders
     set delivery_fee_cents = v_delivery,
         discount_cents = case when v_coupon.kind = 'free_delivery' then 0 else v_discount end
   where id = v_order_id;

  perform public.recompute_order_totals(v_order_id);

  select * into v_order from public.orders where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id, 'code', v_code, 'token', v_token,
    'total_cents', v_order.total_cents, 'discount_cents', v_discount,
    'tax_cents', v_order.tax_cents, 'currency', v_rest.currency,
    'scheduled_for', v_order.scheduled_for
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.settle_payment_intent(p_intent_id uuid, p_status text, p_provider_ref text DEFAULT NULL::text, p_raw jsonb DEFAULT NULL::jsonb, p_fee_cents integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_intent public.payment_intents;
  v_order  public.orders;
  v_ref    text;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception 'INTENT_NOT_FOUND' using errcode = 'P0002'; end if;

  v_ref := coalesce(p_provider_ref, v_intent.provider_ref);

  if v_intent.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true, 'status', 'paid');
  end if;

  if p_status <> 'paid' then
    update public.payment_intents
       set status = p_status::payment_intent_status,
           provider_ref = coalesce(v_ref, provider_ref),
           raw = coalesce(p_raw, raw),
           updated_at = now()
     where id = p_intent_id;
    return jsonb_build_object('ok', true, 'already', false, 'status', p_status);
  end if;

  select * into v_order from public.orders where id = v_intent.order_id for update;
  if v_order.status = 'cancelled' then
    -- Cobrar un pedido anulado no se arregla anotándolo: hay que devolverlo, y
    -- eso lo decide una persona mirando lo que pasó.
    update public.payment_intents
       set status = 'failed', error_code = 'ORDER_CANCELLED',
           provider_ref = v_ref, raw = coalesce(p_raw, raw), updated_at = now()
     where id = p_intent_id;
    return jsonb_build_object('ok', false, 'error', 'ORDER_CANCELLED');
  end if;

  begin
    insert into public.order_payments (
      order_id, restaurant_id, kind, amount_cents, method,
      provider_id, provider_ref, fee_cents, raw, note
    ) values (
      v_intent.order_id, v_intent.restaurant_id, 'charge', v_intent.amount_cents, 'online',
      v_intent.provider_id, v_ref, greatest(coalesce(p_fee_cents, 0), 0), p_raw,
      'Cobro en línea'
    );
  exception when unique_violation then
    -- Ya estaba apuntado: el aviso venía repetido. Se cierra el intento y se
    -- responde que sí, porque para el proveedor la operación está bien.
    update public.payment_intents
       set status = 'paid', provider_ref = v_ref, updated_at = now()
     where id = p_intent_id;
    return jsonb_build_object('ok', true, 'already', true, 'status', 'paid');
  end;

  update public.payment_intents
     set status = 'paid', provider_ref = v_ref, raw = coalesce(p_raw, raw), updated_at = now()
   where id = p_intent_id;

  /*
   * Y ahora sí, el pedido entra en el local.
   *
   * Es el momento exacto en que deja de ser una intención y pasa a ser una
   * comanda. Antes de esta línea no lo ha visto nadie de la cocina, que es lo
   * que evita preparar lo que nunca se pagó.
   */
  update public.orders
     set status = 'pending', updated_at = now()
   where id = v_intent.order_id
     and status = 'awaiting_payment';

  select * into v_order from public.orders where id = v_intent.order_id;

  return jsonb_build_object(
    'ok', true, 'already', false, 'status', 'paid',
    'charged_cents', v_intent.amount_cents,
    'paid_cents', v_order.paid_cents,
    'fully_paid', v_order.payment_status = 'paid');
end $function$
;

CREATE OR REPLACE FUNCTION public.expire_stale_intents()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dudosos jsonb;
  v_caducados int;
  v_abandonados int;
begin
  -- Los que llegaron a la pasarela merecen una pregunta antes que un entierro.
  select coalesce(jsonb_agg(jsonb_build_object(
           'intent_id', i.id, 'method_id', i.method_id, 'provider_ref', i.provider_ref)), '[]'::jsonb)
    into v_dudosos
    from public.payment_intents i
   where i.status = 'redirected' and i.expires_at < now() and i.provider_ref is not null;

  with fuera as (
    update public.payment_intents
       set status = 'expired', updated_at = now()
     where status = 'pending' and expires_at < now()
     returning 1
  ) select count(*)::int into v_caducados from fuera;

  /*
   * Y los pedidos que se quedaron esperando un dinero que no llegó.
   *
   * Sin esto se acumulan invisibles para siempre: no están en ningún panel
   * —que es lo que se quería— pero tampoco se cierran nunca, y el hueco de la
   * franja de entrega que ocupan no se libera.
   */
  with enterrados as (
    update public.orders o
       set status = 'cancelled',
           cancel_reason = 'El pago no llegó a completarse',
           cancelled_at = now(),
           updated_at = now()
     where o.status = 'awaiting_payment'
       and not exists (
         select 1 from public.payment_intents i
          where i.order_id = o.id and i.status in ('pending', 'redirected', 'paid')
       )
       and o.created_at < now() - interval '2 hours'
     returning 1
  ) select count(*)::int into v_abandonados from enterrados;

  return jsonb_build_object('expired', v_caducados, 'abandoned', v_abandonados,
                            'to_check', v_dudosos);
end $function$
;

grant execute on function public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text,
  text, integer, text, uuid, integer, text, text, text, uuid, date, uuid)
  to anon, authenticated;

revoke all on function public.settle_payment_intent(uuid, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.expire_stale_intents() from public, anon, authenticated;
grant execute on function public.settle_payment_intent(uuid, text, text, jsonb, integer) to service_role;
grant execute on function public.expire_stale_intents() to service_role;
