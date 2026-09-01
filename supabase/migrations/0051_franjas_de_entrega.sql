-- =============================================================
--  Fase D · franjas de entrega
--
--  Un restaurante entrega cuando está hecho: veinte minutos, media hora, y el
--  cliente espera. Una compra de la semana no funciona así —hay que estar en
--  casa— y por eso se elige la hora al pedir.
--
--  La columna `scheduled_for` existía desde el principio y nunca se llenó: nada
--  la escribía y nada la leía. Aquí gana el sentido que le faltaba, y con él lo
--  que de verdad hacía falta, que es el cupo: una franja de dos horas con un
--  repartidor no admite quince pedidos por mucho que quepan en la agenda.
-- =============================================================

create table if not exists public.delivery_slots (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,

  -- Día de la semana en norma ISO: 1 es lunes y 7 domingo, igual que el horario
  -- de apertura, para no tener dos convenios distintos en la misma base.
  weekday       smallint not null check (weekday between 1 and 7),
  starts_at     time not null,
  ends_at       time not null,

  -- Cuántos pedidos caben. Cero es sin límite, que es lo que quiere quien
  -- todavía no sabe cuántos puede servir.
  capacity      integer not null default 0 check (capacity >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),

  check (ends_at > starts_at),
  unique (restaurant_id, weekday, starts_at, ends_at)
);

create index if not exists delivery_slots_restaurant_idx
  on public.delivery_slots (restaurant_id, weekday, starts_at);

alter table public.orders
  add column if not exists delivery_slot_id uuid
    references public.delivery_slots(id) on delete set null;

-- El cupo se cuenta por franja y día concreto; sin este índice, cada pedido
-- recorrería la tabla entera para contar tres filas.
create index if not exists orders_slot_idx
  on public.orders (delivery_slot_id, scheduled_for)
  where delivery_slot_id is not null;

alter table public.delivery_slots enable row level security;
alter table public.delivery_slots force row level security;

drop policy if exists delivery_slots_read on public.delivery_slots;
create policy delivery_slots_read on public.delivery_slots
  for select to anon, authenticated using (is_active);

drop policy if exists delivery_slots_write on public.delivery_slots;
create policy delivery_slots_write on public.delivery_slots
  for all to authenticated
  using (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[])
         or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[])
         or public.is_superadmin());

grant select on public.delivery_slots to anon, authenticated;
grant insert, update, delete on public.delivery_slots to authenticated;

/**
 * Las franjas que todavía se pueden elegir, con el hueco que les queda.
 *
 * Devuelve fechas concretas y no días de la semana porque quien pide elige un
 * jueves, no "los jueves". El cálculo se hace en la hora del local: un pedido a
 * las nueve de la noche en Madrid no debe ver el jueves de Canarias.
 */
create or replace function public.available_delivery_slots(
  p_restaurant_id uuid,
  p_days          integer default 7
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with local as (
    select r.timezone as tz, (now() at time zone r.timezone)::date as hoy
      from public.restaurants r where r.id = p_restaurant_id
  ),
  dias as (
    select (l.hoy + d)::date as fecha, l.tz
      from local l,
           generate_series(0, greatest(least(coalesce(p_days, 7), 30), 0)) as d
  ),
  huecos as (
    select s.id, d.fecha, s.starts_at, s.ends_at, s.capacity,
           (d.fecha + s.starts_at) at time zone d.tz as cuando
      from dias d
      join public.delivery_slots s
        on s.restaurant_id = p_restaurant_id
       and s.is_active
       and s.weekday = extract(isodow from d.fecha)::int
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_id', h.id,
    'date', h.fecha,
    'starts_at', to_char(h.starts_at, 'HH24:MI'),
    'ends_at', to_char(h.ends_at, 'HH24:MI'),
    'starts_when', h.cuando,
    'capacity', h.capacity,
    'used', u.usadas,
    -- Sin límite declarado siempre queda sitio.
    'full', h.capacity > 0 and u.usadas >= h.capacity
  ) order by h.cuando), '[]'::jsonb)
  from huecos h
  cross join lateral (
    select count(*)::int as usadas from public.orders o
     where o.delivery_slot_id = h.id
       and o.scheduled_for = h.cuando
       and o.status <> 'cancelled'
  ) u
  where h.cuando > now();
$$;

grant execute on function public.available_delivery_slots(uuid, integer) to anon, authenticated;

-- ---------------------------------------------------------------
-- `place_order` aprende a reservar la franja
--
-- Se borra la versión anterior antes de crear la nueva: dos firmas con el mismo
-- nombre no se sustituyen, conviven, y una llamada con los argumentos de antes
-- dejaría de saber a cuál de las dos va.
-- ---------------------------------------------------------------
drop function if exists public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text,
  text, integer, text, uuid, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.place_order(p_restaurant_slug text, p_items jsonb, p_type order_type, p_payment_method payment_method, p_table_code text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_address_notes text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_tip_cents integer DEFAULT 0, p_coupon_code text DEFAULT NULL::text, p_table_session uuid DEFAULT NULL::uuid, p_covers integer DEFAULT NULL::integer, p_billing_name text DEFAULT NULL::text, p_billing_tax_id text DEFAULT NULL::text, p_billing_address text DEFAULT NULL::text, p_slot_id uuid DEFAULT NULL::uuid, p_slot_date date DEFAULT NULL::date)
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
    payment_method, currency, notes, tip_cents, covers, delivery_slot_id, scheduled_for,
    billing_name, billing_tax_id, billing_address
  ) values (
    v_rest.id, v_table_id, auth.uid(), v_token, v_code, p_type, 'pending',
    p_customer_name, p_customer_phone, p_customer_email, p_address, p_address_notes,
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
end $function$;

grant execute on function public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text,
  text, integer, text, uuid, integer, text, text, text, uuid, date) to anon, authenticated;
