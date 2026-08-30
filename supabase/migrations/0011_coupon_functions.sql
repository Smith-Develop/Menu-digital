-- =============================================================
--  Yumi · validación y canje de cupones
-- =============================================================

-- ---------------------------------------------------------------
-- Descuento que aplica un cupón a una cesta concreta.
--
-- Función interna: la usan tanto la validación previa (para enseñar el importe
-- antes de pedir) como place_order, de modo que el número que ve el cliente y
-- el que se cobra salen siempre del mismo cálculo.
-- ---------------------------------------------------------------
create or replace function public.compute_coupon_discount(
  p_coupon      public.coupons,
  p_restaurant  public.restaurants,
  p_items       jsonb,          -- [{product_id, quantity, unit_total_cents}]
  p_subtotal    integer,
  p_delivery    integer
)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_base integer := 0;
begin
  if p_coupon.kind = 'free_delivery' then
    return least(p_delivery, p_delivery);
  end if;

  -- Sobre qué parte del pedido se calcula el descuento.
  if p_coupon.target = 'order' then
    v_base := p_subtotal;

  elsif p_coupon.target = 'products' then
    select coalesce(sum((item->>'unit_total_cents')::int), 0)
      into v_base
      from jsonb_array_elements(p_items) item
     where (item->>'product_id')::uuid in (
       select product_id from public.coupon_products where coupon_id = p_coupon.id
     );

  elsif p_coupon.target = 'categories' then
    select coalesce(sum((item->>'unit_total_cents')::int), 0)
      into v_base
      from jsonb_array_elements(p_items) item
      join public.products pr on pr.id = (item->>'product_id')::uuid
     where pr.category_id in (
       select category_id from public.coupon_categories where coupon_id = p_coupon.id
     );
  end if;

  if v_base <= 0 then return 0; end if;

  if p_coupon.kind = 'percentage' then
    v_base := floor(v_base * p_coupon.percentage / 100)::int;
    if p_coupon.max_discount_cents is not null then
      v_base := least(v_base, p_coupon.max_discount_cents);
    end if;
  else
    v_base := least(p_coupon.value_cents, v_base);
  end if;

  -- El descuento nunca puede superar lo que se está pagando.
  return greatest(least(v_base, p_subtotal), 0);
end $$;

-- ---------------------------------------------------------------
-- Busca el cupón aplicable a un restaurante.
-- Si existe uno propio con ese código, gana al global del superadministrador.
-- ---------------------------------------------------------------
create or replace function public.find_coupon(p_code text, p_restaurant_id uuid)
returns public.coupons
language sql stable security definer set search_path = public as $$
  select c.*
  from public.coupons c
  where upper(c.code) = upper(btrim(p_code))
    and (c.restaurant_id = p_restaurant_id or c.restaurant_id is null)
  order by (c.restaurant_id is null)   -- false (propio) antes que true (global)
  limit 1;
$$;

-- ---------------------------------------------------------------
-- validate_coupon: lo que llama el carrito antes de confirmar.
-- Devuelve el descuento o un motivo de rechazo legible.
-- ---------------------------------------------------------------
create or replace function public.validate_coupon(
  p_code            text,
  p_restaurant_slug text,
  p_items           jsonb,
  p_type            order_type,
  p_tip_cents       integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rest      public.restaurants%rowtype;
  v_coupon    public.coupons%rowtype;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       integer;
  v_opt_total integer;
  v_line      integer;
  v_subtotal  integer := 0;
  v_delivery  integer := 0;
  v_priced    jsonb := '[]'::jsonb;
  v_discount  integer;
  v_used      integer;
begin
  select * into v_rest from public.restaurants where slug = p_restaurant_slug and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND'); end if;

  v_coupon := public.find_coupon(p_code, v_rest.id);
  if v_coupon.id is null then return jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND'); end if;

  if not v_coupon.is_active then return jsonb_build_object('ok', false, 'error', 'COUPON_INACTIVE'); end if;
  if v_coupon.starts_at > now() then return jsonb_build_object('ok', false, 'error', 'COUPON_NOT_STARTED'); end if;
  if v_coupon.ends_at is not null and v_coupon.ends_at < now() then
    return jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
  end if;
  if v_coupon.max_redemptions is not null and v_coupon.redemptions_count >= v_coupon.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'COUPON_EXHAUSTED');
  end if;

  -- Desde la mesa hace falta cuenta: es lo único que impide que el mismo
  -- comensal canjee el cupón una y otra vez desde el mismo QR.
  if p_type = 'dine_in' and auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'LOGIN_REQUIRED');
  end if;

  if auth.uid() is not null then
    select count(*) into v_used
      from public.coupon_redemptions r
     where r.coupon_id = v_coupon.id and r.customer_id = auth.uid();
    if v_used >= v_coupon.max_per_customer then
      return jsonb_build_object('ok', false, 'error', 'COUPON_ALREADY_USED');
    end if;
  end if;

  -- Recalculamos la cesta con los precios de la base de datos.
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
     where id = (v_item->>'product_id')::uuid and restaurant_id = v_rest.id and is_available;
    continue when not found;

    v_qty := greatest(coalesce((v_item->>'quantity')::int, 1), 1);

    select coalesce(sum(o.price_delta_cents), 0) into v_opt_total
      from public.options o
      join public.option_groups g on g.id = o.group_id
     where g.product_id = v_product.id and o.is_available
       and o.id in (select (jsonb_array_elements_text(coalesce(v_item->'option_ids','[]'::jsonb)))::uuid);

    v_line := (v_product.price_cents + v_opt_total) * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_priced := v_priced || jsonb_build_object(
      'product_id', v_product.id, 'quantity', v_qty, 'unit_total_cents', v_line);
  end loop;

  if v_subtotal < v_coupon.min_order_cents then
    return jsonb_build_object('ok', false, 'error', 'MIN_ORDER_NOT_REACHED',
                              'min_order_cents', v_coupon.min_order_cents);
  end if;

  if p_type = 'delivery' then v_delivery := v_rest.delivery_fee_cents; end if;

  v_discount := public.compute_coupon_discount(v_coupon, v_rest, v_priced, v_subtotal, v_delivery);

  if v_discount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'COUPON_NOT_APPLICABLE');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', upper(v_coupon.code),
    'kind', v_coupon.kind,
    'target', v_coupon.target,
    'description', v_coupon.description,
    'discount_cents', v_discount,
    'is_global', v_coupon.restaurant_id is null
  );
end $$;

grant execute on function public.validate_coupon, public.find_coupon,
  public.compute_coupon_discount to anon, authenticated;
