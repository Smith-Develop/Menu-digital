-- =============================================================
--  Menu Digital · RPC públicas y lógica de pedidos
--
--  El cliente final no tiene sesión. En lugar de exponer las tablas
--  a `anon`, se le dan tres funciones SECURITY DEFINER acotadas:
--  place_order, get_order_by_token y call_waiter.
-- =============================================================

create sequence if not exists public.order_code_seq start 162432;

create or replace function public.next_order_code()
returns text language sql volatile as $$
  select lpad((nextval('public.order_code_seq') % 1000000)::text, 6, '0');
$$;

-- Historial automático de estados.
--
-- Va en DOS triggers a propósito: los timestamps hay que escribirlos en BEFORE
-- (para que formen parte de la misma fila) pero la fila de order_events sólo
-- puede insertarse en AFTER, cuando el pedido ya existe y la clave foránea
-- se puede satisfacer.
create or replace function public.stamp_order_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'confirmed'  and new.accepted_at  is null then new.accepted_at  := now(); end if;
    if new.status = 'ready'      and new.ready_at     is null then new.ready_at     := now(); end if;
    if new.status = 'completed'  and new.completed_at is null then new.completed_at := now(); end if;
    if new.status = 'cancelled'  and new.cancelled_at is null then new.cancelled_at := now(); end if;
  end if;
  return new;
end $$;

create or replace function public.log_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (order_id, status, created_by)
    values (new.id, new.status, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists orders_status_stamp on public.orders;
create trigger orders_status_stamp
  before insert or update of status on public.orders
  for each row execute function public.stamp_order_status();

drop trigger if exists orders_status_log on public.orders;
create trigger orders_status_log
  after insert or update of status on public.orders
  for each row execute function public.log_order_event();

-- ---------------------------------------------------------------
-- place_order: crea pedido + líneas en una sola transacción.
-- Los precios se recalculan SIEMPRE en servidor a partir de la BD;
-- nunca se confía en los importes que manda el navegador.
-- items: [{product_id, quantity, notes, option_ids:[uuid,...]}]
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
  p_tip_cents       integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rest      public.restaurants%rowtype;
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
  v_subtotal  integer := 0;
  v_delivery  integer := 0;
  v_tax       integer := 0;
  v_total     integer := 0;
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

  -- Modalidades habilitadas y método de pago aceptado
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

    -- Sólo se aceptan opciones que pertenezcan realmente a este producto.
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

  v_tax   := round(v_subtotal * v_rest.tax_rate)::int;
  v_total := v_subtotal + v_delivery + v_tax + greatest(coalesce(p_tip_cents,0),0);

  update public.orders
     set subtotal_cents = v_subtotal,
         delivery_fee_cents = v_delivery,
         tax_cents = v_tax,
         total_cents = v_total
   where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id, 'code', v_code, 'token', v_token,
    'total_cents', v_total, 'currency', v_rest.currency
  );
end $$;

-- ---------------------------------------------------------------
-- get_order_by_token: seguimiento sin cuenta. Devuelve sólo lo
-- necesario para la pantalla de tracking (nada de datos internos).
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
      'currency_decimals', r.currency_decimals, 'avg_prep_minutes', r.avg_prep_minutes),
    'table', case when t.id is null then null else jsonb_build_object('name', t.name, 'code', t.code) end,
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
  where o.public_token = p_token;
$$;

-- ---------------------------------------------------------------
-- call_waiter: aviso desde la mesa. Con anti-spam de 60 segundos.
-- ---------------------------------------------------------------
create or replace function public.call_waiter(
  p_table_code text,
  p_type       call_type default 'waiter',
  p_note       text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table public.tables%rowtype;
  v_id    uuid;
begin
  select * into v_table from public.tables where code = p_table_code and is_active;
  if not found then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;

  if exists (
    select 1 from public.waiter_calls
    where table_id = v_table.id and type = p_type and status = 'pending'
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'CALL_ALREADY_PENDING' using errcode = 'P0001';
  end if;

  insert into public.waiter_calls (restaurant_id, table_id, type, note)
  values (v_table.restaurant_id, v_table.id, p_type, nullif(btrim(coalesce(p_note,'')),''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

-- ---------------------------------------------------------------
-- Estadísticas del dashboard (una sola consulta en vez de cinco).
-- ---------------------------------------------------------------
create or replace function public.restaurant_stats(p_restaurant_id uuid, p_days integer default 7)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'orders_today', (select count(*) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date and o.status <> 'cancelled'),
    'revenue_today_cents', (select coalesce(sum(o.total_cents),0) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.created_at::date = current_date and o.status = 'completed'),
    'active_orders', (select count(*) from public.orders o
       where o.restaurant_id = p_restaurant_id and o.status in ('pending','confirmed','preparing','ready','delivering')),
    'pending_calls', (select count(*) from public.waiter_calls c
       where c.restaurant_id = p_restaurant_id and c.status = 'pending'),
    'revenue_series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'cents', d.cents) order by d.day), '[]'::jsonb)
      from (
        select gs::date as day,
               coalesce((select sum(o.total_cents) from public.orders o
                         where o.restaurant_id = p_restaurant_id
                           and o.status = 'completed'
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

-- Sólo el flujo del cliente final se expone a anon.
grant execute on function public.place_order        to anon, authenticated;
grant execute on function public.get_order_by_token to anon, authenticated;
grant execute on function public.call_waiter        to anon, authenticated;
grant execute on function public.restaurant_stats   to authenticated;
revoke execute on function public.next_order_code from anon, authenticated;
