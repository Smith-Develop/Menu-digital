-- =============================================================
--  Fase A · lo que ya se está vendiendo y no existe
--
--  Cuatro correcciones. Las tres primeras son promesas que la plataforma hace
--  hoy y no cumple: un plan que dice restringir el reparto y no lo restringe,
--  un escaparate que anuncia locales que no pueden vender, y unos horarios que
--  se guardan y no los lee nadie. La cuarta es una numeración de pedidos que
--  comparten todos los restaurantes.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · El plan decide si hay reparto
--
-- `plans.allows_delivery` se guardaba, se editaba desde el superadmin y se
-- pintaba en la tarjeta que ve el restaurante. No se leía en ningún sitio: un
-- local con un plan "sin reparto" repartía igual. Se estaba vendiendo una
-- restricción que no existía.
-- ---------------------------------------------------------------
create or replace function public.delivery_allowed(p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select r.delivery_enabled
     and coalesce((
       select pl.allows_delivery
       from public.subscriptions s
       join public.plans pl on pl.id = s.plan_id
       where s.restaurant_id = r.id
         and s.status in ('trialing', 'active', 'past_due')
       order by s.created_at desc
       limit 1
     ), true)   -- sin plan asignado todavía no se restringe nada
  from public.restaurants r
  where r.id = p_restaurant_id;
$$;

grant execute on function public.delivery_allowed(uuid) to anon, authenticated;

-- ---------------------------------------------------------------
-- 2 · Los horarios se aplican
--
-- `opening_hours` se guardaba y no lo leía nadie: abrir y cerrar era un
-- interruptor que alguien tenía que acordarse de pulsar, así que un local que
-- olvidara cerrar recibía pedidos de madrugada.
--
-- El formato es {"1": [["09:00","16:00"], ["20:00","23:30"]], …} con los días
-- de la semana en ISO —1 es lunes— y tantos tramos como haga falta. Un objeto
-- vacío significa "sin horario definido", y entonces manda el interruptor: los
-- locales que ya existen siguen funcionando exactamente igual.
-- ---------------------------------------------------------------
create or replace function public.restaurant_is_open_now(p_restaurant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rest    public.restaurants;
  v_ahora   timestamp;
  v_dia     text;
  v_hora    text;
  v_tramo   jsonb;
  v_desde   text;
  v_hasta   text;
begin
  select * into v_rest from public.restaurants where id = p_restaurant_id;
  if not found then return false; end if;

  -- El interruptor manda siempre: sirve para cerrar antes de tiempo.
  if not v_rest.is_open then return false; end if;

  if v_rest.opening_hours is null or v_rest.opening_hours = '{}'::jsonb then
    return true;
  end if;

  v_ahora := now() at time zone coalesce(nullif(v_rest.timezone, ''), 'Europe/Madrid');
  v_dia   := extract(isodow from v_ahora)::text;
  v_hora  := to_char(v_ahora, 'HH24:MI');

  for v_tramo in
    select * from jsonb_array_elements(coalesce(v_rest.opening_hours -> v_dia, '[]'::jsonb))
  loop
    v_desde := v_tramo ->> 0;
    v_hasta := v_tramo ->> 1;
    continue when v_desde is null or v_hasta is null;

    if v_desde <= v_hasta then
      if v_hora >= v_desde and v_hora < v_hasta then return true; end if;
    else
      -- Tramo que cruza la medianoche: de 20:00 a 02:00 son dos trozos.
      if v_hora >= v_desde or v_hora < v_hasta then return true; end if;
    end if;
  end loop;

  return false;
end;
$$;

grant execute on function public.restaurant_is_open_now(uuid) to anon, authenticated;

-- ---------------------------------------------------------------
-- 3 · Numeración de pedidos por local
--
-- Salía de una secuencia global de la plataforma con vuelta a cero cada millón,
-- así que dos restaurantes veían numeraciones salteadas y con huecos. Cada uno
-- lleva ahora su propio contador, sembrado desde el número más alto que ya
-- tenga para que no se repita ninguno.
-- ---------------------------------------------------------------
alter table public.restaurants
  add column if not exists order_counter bigint not null default 0;

update public.restaurants r
   set order_counter = greatest(coalesce((
     select max(nullif(regexp_replace(o.code, '\D', '', 'g'), '')::bigint)
     from public.orders o where o.restaurant_id = r.id
   ), 0), r.order_counter);

create or replace function public.next_order_code_for(p_restaurant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num bigint;
begin
  -- El bloqueo de fila serializa dos pedidos simultáneos del mismo local: sin
  -- él dos comandas podrían salir con el mismo número.
  update public.restaurants
     set order_counter = order_counter + 1
   where id = p_restaurant_id
  returning order_counter into v_num;

  return lpad(v_num::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------
-- 4 · `place_order` aplica las tres reglas
-- ---------------------------------------------------------------
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
  p_table_session   uuid default null,
  p_covers          integer default null,
  p_billing_name    text default null,
  p_billing_tax_id  text default null,
  p_billing_address text default null
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
  v_discount  integer := 0;
  v_used      integer;
  v_order     public.orders;
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

  if p_type = 'delivery' and coalesce(btrim(p_address), '') = '' then
    raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001';
  end if;

  v_code  := public.next_order_code_for(v_rest.id);
  v_token := gen_random_uuid();

  insert into public.orders (
    restaurant_id, table_id, customer_id, public_token, code, type, status,
    customer_name, customer_phone, customer_email, address, address_notes,
    payment_method, currency, notes, tip_cents, covers,
    billing_name, billing_tax_id, billing_address
  ) values (
    v_rest.id, v_table_id, auth.uid(), v_token, v_code, p_type, 'pending',
    p_customer_name, p_customer_phone, p_customer_email, p_address, p_address_notes,
    p_payment_method, v_rest.currency, p_notes, greatest(coalesce(p_tip_cents,0), 0),
    nullif(greatest(coalesce(p_covers, 0), 0), 0),
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
    'tax_cents', v_order.tax_cents, 'currency', v_rest.currency
  );
end $$;

grant execute on function public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text, text,
  integer, text, uuid, integer, text, text, text
) to anon, authenticated;

-- ---------------------------------------------------------------
-- 5 · El escaparate deja de anunciar locales que no pueden vender
--
-- La política de lectura filtraba por activo pero no por suscripción viva; las
-- de productos y categorías sí. El local aparecía en el listado, el cliente
-- entraba y se encontraba una tienda vacía sin explicación.
--
-- El equipo del local y el superadministrador lo siguen viendo por sus propias
-- políticas, así que el dueño de un local caducado entra a su panel igual y
-- puede renovar.
-- ---------------------------------------------------------------
drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants
  for select to anon, authenticated
  using (is_active and public.restaurant_is_live(id));
