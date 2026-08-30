-- =============================================================
--  Yumi · place_order con cupón + cuenta de mesa + invitaciones
-- =============================================================

-- La firma cambia (llega p_coupon_code), así que CREATE OR REPLACE crearía una
-- sobrecarga en lugar de sustituirla: hay que retirar la anterior primero.
drop function if exists public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text, text, integer);

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
  p_coupon_code     text default null
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
      where code = p_table_code and restaurant_id = v_rest.id and is_active;
    if v_table_id is null then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;
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
    if p_type = 'dine_in' and auth.uid() is null then
      raise exception 'LOGIN_REQUIRED' using errcode = 'P0001';
    end if;

    -- El contador se bloquea aquí: dos pedidos simultáneos con el último cupón
    -- disponible se serializan y solo uno pasa.
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

  -- El impuesto se calcula sobre la base ya descontada.
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
  text, jsonb, order_type, payment_method, text, text, text, text, text, text, text, integer, text
) to anon, authenticated;

-- ---------------------------------------------------------------
-- Cuenta abierta de una mesa.
--
-- Los pedidos de una mesa no desaparecen al entregarse: se quedan a la vista
-- hasta que el restaurante los cobra, que es cuando la mesa queda libre.
-- ---------------------------------------------------------------
create or replace function public.table_bill(p_table_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'table', jsonb_build_object('name', t.name, 'code', t.code),
    'restaurant', jsonb_build_object(
      'name', r.name, 'slug', r.slug, 'currency', r.currency,
      'currency_decimals', r.currency_decimals),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'token', o.public_token,
        'code', o.code,
        'status', o.status,
        'payment_status', o.payment_status,
        'total_cents', o.total_cents,
        'discount_cents', o.discount_cents,
        'coupon_code', o.coupon_code,
        'created_at', o.created_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', i.name_snapshot, 'quantity', i.quantity,
            'line_total_cents', i.line_total_cents,
            'options', i.options) order by i.created_at), '[]'::jsonb)
          from public.order_items i where i.order_id = o.id)
      ) order by o.created_at)
      from public.orders o
      where o.table_id = t.id
        and o.status <> 'cancelled'
        and o.payment_status <> 'paid'
    ), '[]'::jsonb),
    'total_cents', coalesce((
      select sum(o.total_cents) from public.orders o
      where o.table_id = t.id and o.status <> 'cancelled' and o.payment_status <> 'paid'
    ), 0)
  )
  from public.tables t
  join public.restaurants r on r.id = t.restaurant_id
  where t.code = p_table_code and t.is_active;
$$;

grant execute on function public.table_bill(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- Aceptar una invitación de equipo con la cuenta ya iniciada.
-- ---------------------------------------------------------------
create or replace function public.accept_staff_invitation(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inv     public.staff_invitations%rowtype;
  v_email   text;
  v_courier uuid;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_inv from public.staff_invitations
   where token = p_token and accepted_at is null for update;

  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITATION_EXPIRED' using errcode = 'P0001'; end if;

  -- La invitación va dirigida a un correo concreto: no vale reenviar el enlace.
  select email into v_email from public.profiles where id = auth.uid();
  if lower(coalesce(v_email, '')) <> lower(v_inv.email) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.restaurant_staff (restaurant_id, user_id, role, is_active)
  values (v_inv.restaurant_id, auth.uid(), v_inv.role, true)
  on conflict (restaurant_id, user_id)
  do update set role = excluded.role, is_active = true;

  if v_inv.as_courier then
    insert into public.couriers (user_id, status)
    values (auth.uid(), 'offline')
    on conflict (user_id) do update set is_active = true
    returning id into v_courier;

    insert into public.restaurant_couriers (restaurant_id, courier_id)
    values (v_inv.restaurant_id, v_courier)
    on conflict (restaurant_id, courier_id) do update set is_active = true;
  end if;

  update public.profiles set role = 'restaurant'
   where id = auth.uid() and role = 'customer';

  update public.staff_invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return jsonb_build_object('ok', true, 'restaurant_id', v_inv.restaurant_id, 'role', v_inv.role);
end $$;

grant execute on function public.accept_staff_invitation(text) to authenticated;

-- Datos mínimos de una invitación para pintar la pantalla de bienvenida.
create or replace function public.invitation_preview(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', i.email,
    'role', i.role,
    'as_courier', i.as_courier,
    'expired', i.expires_at < now(),
    'accepted', i.accepted_at is not null,
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'logo_url', r.logo_url)
  )
  from public.staff_invitations i
  join public.restaurants r on r.id = i.restaurant_id
  where i.token = p_token;
$$;

grant execute on function public.invitation_preview(text) to anon, authenticated;
