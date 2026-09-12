-- =============================================================
--  El estado hay que decirlo en su tipo
--
--  La migración 0078 puso el estado del pedido dentro de un `case`, y un `case`
--  de literales devuelve texto: Postgres no lo convierte solo al insertarlo en
--  una columna de enumerado. El resultado es que `place_order` dejó de crear
--  pedidos —todos, no sólo los de pago por internet— con un error que sólo
--  aparece al ejecutarla, no al crearla.
--
--  Lo encontró la suite de pasarelas en la primera pasada, que es exactamente
--  para lo que está. Una migración que se aplica sin protestar no es una
--  migración que funcione.
-- =============================================================

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
    (case when p_payment_method = 'online' then 'awaiting_payment' else 'pending' end)::order_status,
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

grant execute on function public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text,
  text, integer, text, uuid, integer, text, text, text, uuid, date, uuid)
  to anon, authenticated;
