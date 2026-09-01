-- =============================================================
--  Fase 3 de la auditoría · el ticket se convierte en documento
--
--  Lo que se imprimía no podía defenderse ante una inspección: sin serie ni
--  numeración correlativa, sin identificación fiscal del emisor, sin desglose
--  por tipo impositivo y con un número de pedido que es un contador global de
--  la plataforma, compartido por todos los restaurantes y con vuelta a cero
--  cada millón.
--
--  Dos cambios de fondo. El impuesto pasa a calcularse por línea, porque en
--  hostelería la comida, la bebida alcohólica y el servicio tributan distinto y
--  un porcentaje único por restaurante no puede expresarlo. Y el documento
--  emitido deja de derivarse del pedido: se congela con todos sus datos, de
--  modo que tocar el pedido después no reescribe una factura ya entregada.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · El impuesto vive en el producto
--
-- Nulo significa "el del restaurante": la inmensa mayoría de la carta tributa
-- igual, y obligar a rellenarlo plato a plato sería trabajo sin premio.
-- ---------------------------------------------------------------
alter table public.products
  add column if not exists tax_rate numeric(5,4);

comment on column public.products.tax_rate is
  'Tipo impositivo del plato. Nulo usa el general del restaurante.';

-- Cada línea guarda el tipo que se le aplicó y lo que salió, igual que guarda
-- el precio: si mañana cambia el IVA, el histórico tiene que seguir contando
-- lo que de verdad se cobró.
alter table public.order_items
  add column if not exists tax_rate          numeric(5,4) not null default 0,
  add column if not exists discount_cents    integer not null default 0,
  add column if not exists taxable_base_cents integer not null default 0,
  add column if not exists tax_cents         integer not null default 0;

-- Datos fiscales del cliente, para la factura nominativa. Y los comensales,
-- que hacen falta para el gasto medio por persona y para el propio documento.
alter table public.orders
  add column if not exists covers           integer,
  add column if not exists billing_name     text,
  add column if not exists billing_tax_id   text,
  add column if not exists billing_address  text;

-- ---------------------------------------------------------------
-- 2 · El cálculo del dinero, en un solo sitio
--
-- `place_order` y `recompute_order_totals` calculaban por separado, con la
-- misma aritmética escrita dos veces: cualquier corrección en una se olvidaba
-- en la otra. Ahora crear un pedido y recalcularlo pasan por la misma función.
--
-- El descuento se reparte entre las líneas en proporción a su importe, porque
-- el impuesto se aplica sobre la base ya descontada y cada línea puede tributar
-- distinto. El céntimo que sobra al repartir se lo lleva la última línea.
-- ---------------------------------------------------------------
create or replace function public.recompute_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders;
  v_rest    public.restaurants;
  v_sub     int;
  v_sub_ini int;
  v_cupon   int;
  v_desc    int;
  v_linea   record;
  v_repart  int := 0;
  v_parte   int;
  v_ultima  uuid;
  v_tax     int;
begin
  select * into v_order from public.orders where id = p_order_id;
  select * into v_rest from public.restaurants where id = v_order.restaurant_id;

  select coalesce(sum(line_total_cents), 0) into v_sub
    from public.order_items where order_id = p_order_id and voided_at is null;
  select coalesce(sum(line_total_cents), 0) into v_sub_ini
    from public.order_items where order_id = p_order_id;

  -- El descuento de cupón guardado corresponde a la cesta completa; si se ha
  -- retirado alguna línea se conserva en proporción a lo que queda.
  v_cupon := case
    when v_sub_ini > 0 then round(v_order.discount_cents::numeric * v_sub / v_sub_ini)::int
    else 0
  end;
  v_desc := least(v_cupon + v_order.manual_discount_cents, v_sub);

  select id into v_ultima
    from public.order_items
   where order_id = p_order_id and voided_at is null
   order by created_at desc limit 1;

  for v_linea in
    select i.id, i.line_total_cents,
           -- El tipo guardado manda: es la instantánea del momento de pedir.
           -- Volver a sacarlo del producto haría que una subida del IVA
           -- reescribiera los pedidos que ya están en marcha.
           coalesce(nullif(i.tax_rate, 0), p.tax_rate, v_rest.tax_rate) as tipo
      from public.order_items i
      left join public.products p on p.id = i.product_id
     where i.order_id = p_order_id and i.voided_at is null
     order by i.created_at
  loop
    v_parte := case
      when v_linea.id = v_ultima then v_desc - v_repart          -- el resto
      when v_sub > 0 then round(v_desc::numeric * v_linea.line_total_cents / v_sub)::int
      else 0
    end;
    v_repart := v_repart + v_parte;

    update public.order_items
       set tax_rate = v_linea.tipo,
           discount_cents = v_parte,
           taxable_base_cents = greatest(v_linea.line_total_cents - v_parte, 0),
           tax_cents = round(greatest(v_linea.line_total_cents - v_parte, 0) * v_linea.tipo)::int
     where id = v_linea.id;
  end loop;

  -- Las líneas retiradas dejan de aportar impuesto.
  update public.order_items
     set discount_cents = 0, taxable_base_cents = 0, tax_cents = 0
   where order_id = p_order_id and voided_at is not null;

  select coalesce(sum(tax_cents), 0) into v_tax
    from public.order_items where order_id = p_order_id and voided_at is null;

  -- El envío tributa al tipo general del local: no es un plato y no tiene el
  -- suyo propio.
  v_tax := v_tax + round(v_order.delivery_fee_cents * v_rest.tax_rate)::int;

  update public.orders
     set subtotal_cents = v_sub,
         discount_cents = v_cupon,
         tax_cents      = v_tax,
         total_cents    = greatest(v_sub - v_desc + v_tax + delivery_fee_cents + tip_cents, 0)
   where id = p_order_id;

  perform public.recompute_order_payment(p_order_id);
end;
$$;

-- `place_order` deja de calcular por su cuenta y usa la misma función.
drop function if exists public.place_order(
  text, jsonb, order_type, payment_method, text, text, text, text, text, text, text, integer, text, uuid);

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

  -- El envío y el descuento se dejan puestos; el resto lo calcula la función
  -- común, que es la única que sabe repartir el descuento y aplicar el tipo de
  -- cada línea.
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
-- 3 · Series y numeración
--
-- Correlativa por restaurante y por serie, sin huecos ni reinicios. El número
-- del pedido no vale: es un contador global de la plataforma que comparten
-- todos los locales y que vuelve a cero cada millón.
-- ---------------------------------------------------------------
do $$ begin
  create type fiscal_document_kind as enum ('simplified', 'invoice', 'credit_note');
exception when duplicate_object then null; end $$;

create table if not exists public.fiscal_series (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          fiscal_document_kind not null,
  code          text not null,             -- 'T' tickets, 'F' facturas, 'R' rectificativas
  next_number   bigint not null default 1,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, kind)
);

create table if not exists public.fiscal_documents (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  series_id     uuid not null references public.fiscal_series(id),
  kind          fiscal_document_kind not null,
  number        bigint not null,
  full_number   text not null,             -- 'F-000042'

  -- `restrict` y no `set null`: un pedido con factura emitida no se puede
  -- borrar, y desligarlo tampoco vale. El documento tiene que seguir señalando
  -- la venta que justifica, o deja de justificar nada.
  order_id      uuid references public.orders(id) on delete restrict,
  -- Una rectificativa apunta al documento que corrige. Nunca se toca el
  -- original: se emite otro que lo enmienda, que es lo que exige que un
  -- documento entregado siga diciendo lo que decía.
  replaces_id   uuid references public.fiscal_documents(id) on delete set null,

  issued_at     timestamptz not null default now(),
  issued_by     uuid references public.profiles(id) on delete set null,

  -- Todo congelado. Un documento no puede depender del pedido, porque el
  -- pedido puede cambiar después y la factura ya está en manos del cliente.
  issuer_name       text not null,
  issuer_tax_id     text,
  issuer_address    text,
  customer_name     text,
  customer_tax_id   text,
  customer_address  text,

  currency          char(3) not null,
  currency_decimals smallint not null,
  subtotal_cents    integer not null,
  discount_cents    integer not null default 0,
  tax_cents         integer not null default 0,
  total_cents       integer not null,
  -- [{rate, base_cents, tax_cents}] — el desglose que exige una factura.
  tax_breakdown     jsonb not null default '[]'::jsonb,
  lines             jsonb not null default '[]'::jsonb,
  payments          jsonb not null default '[]'::jsonb,

  note          text,
  created_at    timestamptz not null default now(),
  unique (series_id, number)
);

create index if not exists fiscal_documents_restaurant_idx
  on public.fiscal_documents (restaurant_id, issued_at desc);
create index if not exists fiscal_documents_order_idx
  on public.fiscal_documents (order_id);

/**
 * Un documento emitido no se toca.
 *
 * Ni el dueño ni la aplicación pueden modificarlo o borrarlo: si estuviera mal,
 * se emite una rectificativa. Es justo lo que distingue un documento fiscal de
 * una línea de una tabla cualquiera.
 */
create or replace function public.fiscal_documents_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sin sesión de usuario es mantenimiento del propio servidor. Un superusuario
  -- puede desactivar cualquier disparador de todos modos, así que fingir que
  -- esto lo detiene sería engañoso: lo que protege es a la aplicación, que es
  -- de donde vienen los cambios que importa impedir.
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'FISCAL_DOCUMENT_IMMUTABLE' using errcode = '42501';
end $$;

drop trigger if exists fiscal_documents_no_update on public.fiscal_documents;
create trigger fiscal_documents_no_update
  before update or delete on public.fiscal_documents
  for each row execute function public.fiscal_documents_immutable();

/** Reserva el siguiente número de una serie, creándola si hace falta. */
create or replace function public.next_fiscal_number(
  p_restaurant_id uuid,
  p_kind fiscal_document_kind
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serie public.fiscal_series;
begin
  insert into public.fiscal_series (restaurant_id, kind, code)
  values (p_restaurant_id, p_kind,
          case p_kind when 'invoice' then 'F' when 'credit_note' then 'R' else 'T' end)
  on conflict (restaurant_id, kind) do nothing;

  -- El bloqueo serializa dos emisiones simultáneas: sin él dos cajas podrían
  -- sacar el mismo número, que es exactamente lo que la correlatividad
  -- prohíbe.
  select * into v_serie from public.fiscal_series
   where restaurant_id = p_restaurant_id and kind = p_kind for update;

  update public.fiscal_series set next_number = next_number + 1 where id = v_serie.id;

  return jsonb_build_object(
    'series_id', v_serie.id,
    'number', v_serie.next_number,
    'full_number', v_serie.code || '-' || lpad(v_serie.next_number::text, 6, '0'));
end;
$$;

/**
 * Emite el documento de una venta.
 *
 * Si se piden datos fiscales del cliente sale factura; si no, ticket
 * simplificado, que es lo que se entrega en la barra. Un pedido no puede tener
 * dos documentos del mismo tipo: el segundo intento devuelve el que ya existe
 * en lugar de duplicar la numeración.
 */
create or replace function public.issue_fiscal_document(
  p_order_id        uuid,
  p_customer_name   text default null,
  p_customer_tax_id text default null,
  p_customer_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rest  public.restaurants;
  v_kind  fiscal_document_kind;
  v_num   jsonb;
  v_id    uuid;
  v_ya    public.fiscal_documents;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_charge(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CHARGE' using errcode = '42501';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = 'P0001';
  end if;

  -- Sin cobrar no hay documento: lo que se emite es el justificante de una
  -- venta hecha, no de una prevista.
  if v_order.paid_cents <= 0 then
    raise exception 'NOT_PAID' using errcode = 'P0001';
  end if;

  select * into v_rest from public.restaurants where id = v_order.restaurant_id;

  v_kind := case
    when coalesce(nullif(btrim(coalesce(p_customer_tax_id,'')), ''), v_order.billing_tax_id) is not null
    then 'invoice' else 'simplified'
  end::fiscal_document_kind;

  select * into v_ya from public.fiscal_documents
   where order_id = p_order_id and kind = v_kind limit 1;
  if found then
    return jsonb_build_object('ok', true, 'already', true,
                              'id', v_ya.id, 'full_number', v_ya.full_number);
  end if;

  v_num := public.next_fiscal_number(v_order.restaurant_id, v_kind);

  insert into public.fiscal_documents (
    restaurant_id, series_id, kind, number, full_number, order_id, issued_by,
    issuer_name, issuer_tax_id, issuer_address,
    customer_name, customer_tax_id, customer_address,
    currency, currency_decimals,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    tax_breakdown, lines, payments
  ) values (
    v_order.restaurant_id, (v_num->>'series_id')::uuid, v_kind, (v_num->>'number')::bigint, v_num->>'full_number',
    p_order_id, auth.uid(),
    v_rest.name, v_rest.document_number, v_rest.address,
    coalesce(nullif(btrim(coalesce(p_customer_name,'')), ''), v_order.billing_name, v_order.customer_name),
    coalesce(nullif(btrim(coalesce(p_customer_tax_id,'')), ''), v_order.billing_tax_id),
    coalesce(nullif(btrim(coalesce(p_customer_address,'')), ''), v_order.billing_address, v_order.address),
    v_order.currency, v_rest.currency_decimals,
    v_order.subtotal_cents,
    v_order.discount_cents + v_order.manual_discount_cents,
    v_order.tax_cents, v_order.total_cents,

    -- Desglose por tipo: la parte que hacía imposible emitir una factura
    -- correcta cuando la comida y la bebida tributan distinto.
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'rate', x.tax_rate, 'base_cents', x.base, 'tax_cents', x.impuesto) order by x.tax_rate)
      from (
        select tax_rate, sum(taxable_base_cents)::int as base, sum(tax_cents)::int as impuesto
        from public.order_items
        where order_id = p_order_id and voided_at is null
        group by tax_rate
      ) x), '[]'::jsonb),

    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents,
        'line_total_cents', i.line_total_cents,
        'tax_rate', i.tax_rate, 'tax_cents', i.tax_cents,
        'options', i.options) order by i.created_at)
      from public.order_items i
      where i.order_id = p_order_id and i.voided_at is null), '[]'::jsonb),

    coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', p.method, 'amount_cents', p.amount_cents, 'kind', p.kind,
        'created_at', p.created_at) order by p.created_at)
      from public.order_payments p where p.order_id = p_order_id), '[]'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'already', false,
                            'id', v_id, 'kind', v_kind, 'full_number', v_num->>'full_number');
end;
$$;

/**
 * Emite una rectificativa sobre un documento ya entregado.
 *
 * Es la contrapartida fiscal de la devolución: el importe va en negativo y
 * queda enlazado al original, que sigue existiendo intacto.
 */
create or replace function public.issue_credit_note(
  p_document_id  uuid,
  p_reason       text,
  p_amount_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc    public.fiscal_documents;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
  v_num    jsonb;
  v_id     uuid;
  v_imp    int;
  v_prop   numeric;
begin
  select * into v_doc from public.fiscal_documents where id = p_document_id;
  if not found then raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_cancel_orders(v_doc.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_REFUND' using errcode = '42501';
  end if;

  if v_motivo is null then raise exception 'REFUND_REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v_doc.kind = 'credit_note' then raise exception 'ALREADY_CREDIT_NOTE' using errcode = 'P0001'; end if;

  v_imp := coalesce(p_amount_cents, v_doc.total_cents);
  if v_imp <= 0 or v_imp > v_doc.total_cents then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- En una rectificativa parcial el impuesto se reparte en la misma proporción
  -- que el importe: devolver la mitad devuelve la mitad del impuesto.
  v_prop := v_imp::numeric / nullif(v_doc.total_cents, 0);

  v_num := public.next_fiscal_number(v_doc.restaurant_id, 'credit_note');

  insert into public.fiscal_documents (
    restaurant_id, series_id, kind, number, full_number, order_id, replaces_id, issued_by,
    issuer_name, issuer_tax_id, issuer_address,
    customer_name, customer_tax_id, customer_address,
    currency, currency_decimals,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    tax_breakdown, lines, note
  ) values (
    v_doc.restaurant_id, (v_num->>'series_id')::uuid, 'credit_note', (v_num->>'number')::bigint, v_num->>'full_number',
    v_doc.order_id, v_doc.id, auth.uid(),
    v_doc.issuer_name, v_doc.issuer_tax_id, v_doc.issuer_address,
    v_doc.customer_name, v_doc.customer_tax_id, v_doc.customer_address,
    v_doc.currency, v_doc.currency_decimals,
    -round(v_doc.subtotal_cents * v_prop)::int,
    -round(v_doc.discount_cents * v_prop)::int,
    -round(v_doc.tax_cents * v_prop)::int,
    -v_imp,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'rate', b->>'rate',
        'base_cents', -round((b->>'base_cents')::int * v_prop)::int,
        'tax_cents', -round((b->>'tax_cents')::int * v_prop)::int))
      from jsonb_array_elements(v_doc.tax_breakdown) b), '[]'::jsonb),
    v_doc.lines,
    v_motivo
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'full_number', v_num->>'full_number',
                            'total_cents', -v_imp);
end;
$$;

/** Documentos emitidos de un pedido. */
create or replace function public.order_documents(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'full_number', d.full_number,
    'issued_at', d.issued_at, 'total_cents', d.total_cents,
    'customer_name', d.customer_name, 'customer_tax_id', d.customer_tax_id,
    'tax_breakdown', d.tax_breakdown, 'replaces_id', d.replaces_id
  ) order by d.issued_at), '[]'::jsonb)
  from public.fiscal_documents d
  where d.order_id = p_order_id
    and (public.is_staff_of(d.restaurant_id) or public.is_superadmin());
$$;

-- ---------------------------------------------------------------
-- 4 · Acceso
-- ---------------------------------------------------------------
alter table public.fiscal_series    enable row level security;
alter table public.fiscal_series    force row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_documents force row level security;

drop policy if exists fiscal_series_read on public.fiscal_series;
create policy fiscal_series_read on public.fiscal_series
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());

drop policy if exists fiscal_documents_read on public.fiscal_documents;
create policy fiscal_documents_read on public.fiscal_documents
  for select to authenticated
  using (
    public.is_staff_of(restaurant_id)
    or public.is_superadmin()
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );

grant select on public.fiscal_series, public.fiscal_documents to authenticated;

grant execute on function public.issue_fiscal_document(uuid, text, text, text) to authenticated;
grant execute on function public.issue_credit_note(uuid, text, integer) to authenticated;
grant execute on function public.order_documents(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 5 · Traspaso de lo ya vendido
--
-- Las líneas antiguas no tienen tipo ni base: se rellenan con el tipo general
-- del local para que el desglose de un documento emitido sobre un pedido viejo
-- no salga vacío.
-- ---------------------------------------------------------------
update public.order_items i
   set tax_rate = r.tax_rate,
       taxable_base_cents = i.line_total_cents,
       tax_cents = round(i.line_total_cents * r.tax_rate)::int
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
 where i.order_id = o.id and i.tax_rate = 0 and i.voided_at is null;
