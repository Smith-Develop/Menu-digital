-- =============================================================
--  Fase D · preparar el pedido cuando no hay cocina
--
--  En un restaurante la comanda se cocina: sale del pedido y llega hecha. En un
--  supermercado el pedido se *recoge*, y eso cambia dos cosas que el modelo
--  actual no contempla.
--
--  La primera es el recorrido. Quien prepara camina la tienda, y necesita la
--  lista ordenada por pasillo, no por el orden en que el cliente la fue
--  metiendo en el carrito. Con doce platos da igual; con cuarenta referencias
--  repartidas por seis pasillos, no.
--
--  La segunda, y más importante, es que puede no haber. Un plato de la carta o
--  está o no está y se avisa antes; un bote concreto se acaba a media mañana.
--  Entonces hay que llevar menos, o llevar otro, y el dinero tiene que seguir
--  a lo que de verdad va en la bolsa. Sin esto, el supermercado cobra lo que
--  pidió el cliente y entrega lo que había.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · La línea recuerda lo que se pidió
--
-- `quantity` va a pasar a significar "lo que se lleva". Lo que se pidió deja de
-- poder deducirse, y hace falta: es lo que se le enseña al cliente para
-- explicarle por qué le llega menos de lo que encargó.
-- ---------------------------------------------------------------
alter table public.order_items
  add column if not exists ordered_qty  integer,
  add column if not exists picked_qty   integer,
  add column if not exists picked_at    timestamptz,
  add column if not exists picked_by    uuid references public.profiles(id) on delete set null,
  add column if not exists pick_note    text,
  -- Lo que había pedido, cuando se le ha cambiado por otra cosa.
  add column if not exists replaced_from jsonb;

update public.order_items set ordered_qty = quantity where ordered_qty is null;

create or replace function public.set_ordered_qty()
returns trigger
language plpgsql
as $$
begin
  new.ordered_qty := coalesce(new.ordered_qty, new.quantity);
  return new;
end $$;

drop trigger if exists order_items_ordered_qty on public.order_items;
create trigger order_items_ordered_qty
  before insert on public.order_items
  for each row execute function public.set_ordered_qty();

-- ---------------------------------------------------------------
-- 2 · La lista por pasillos
--
-- El orden es el de las categorías del catálogo, que es el que el superadmin ya
-- puede ordenar. Si mañana esas categorías se llaman pasillos y se ordenan como
-- está la tienda, la lista sale sola en el orden correcto.
-- ---------------------------------------------------------------
create or replace function public.order_picking_list(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'name', i.name_snapshot,
    'image', i.image_snapshot,
    'notes', i.notes,
    'ordered_qty', coalesce(i.ordered_qty, i.quantity),
    'quantity', i.quantity,
    'picked_qty', i.picked_qty,
    'picked_at', i.picked_at,
    'pick_note', i.pick_note,
    'replaced_from', i.replaced_from,
    'voided_at', i.voided_at,
    'unit', p.unit,
    'barcode', p.barcode,
    'brand', p.brand,
    'pack_size', p.pack_size,
    'stock_qty', case when p.track_stock then p.stock_qty end,
    'aisle', coalesce(padre.name, c.name),
    'aisle_position', coalesce(padre.position, c.position, 999),
    'shelf', case when padre.id is not null then c.name end
  ) order by coalesce(padre.position, c.position, 999), c.position, i.created_at), '[]'::jsonb)
  from public.order_items i
  left join public.products p on p.id = i.product_id
  left join public.catalog_categories c     on c.id = p.catalog_category_id
  left join public.catalog_categories padre on padre.id = c.parent_id
  where i.order_id = p_order_id;
$$;

grant execute on function public.order_picking_list(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 3 · Recoger una línea
--
-- Recoger menos de lo pedido no es un descuento ni una cortesía: es que el
-- pedido ha cambiado. La línea se reduce, los totales se rehacen y, si ya
-- estaba cobrado, la diferencia se devuelve. Que el dinero se mueva solo es el
-- punto entero de esta función; dejarlo a mano es dejarlo sin hacer.
-- ---------------------------------------------------------------
create or replace function public.pick_order_item(
  p_item_id uuid,
  p_qty     integer,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    public.order_items;
  v_order   public.orders;
  v_pedida  int;
  v_unidad  int;
  v_antes   int;
  v_despues int;
  v_vivas   int;
  v_sobra   int;
begin
  select * into v_item from public.order_items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_order from public.orders where id = v_item.order_id;

  if not public.is_staff_of(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_order.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;

  v_pedida := coalesce(v_item.ordered_qty, v_item.quantity);

  if p_qty is null or p_qty < 0 or p_qty > v_pedida then
    raise exception 'PICK_QTY_OUT_OF_RANGE' using errcode = 'P0001';
  end if;

  -- El precio unitario se saca de la línea y no del producto: si el producto
  -- sube de precio a media mañana, el pedido en curso no se entera.
  v_unidad := v_item.line_total_cents / greatest(v_item.quantity, 1);
  v_antes  := v_order.total_cents;

  if p_qty = 0 then
    select count(*) into v_vivas
      from public.order_items
     where order_id = v_item.order_id and voided_at is null and id <> p_item_id;

    if v_vivas = 0 then
      -- No queda nada que entregar. Eso no es un pedido corregido, es un pedido
      -- que no existe, y anularlo es una decisión con motivo y con permiso.
      raise exception 'NOTHING_PICKED' using errcode = 'P0001';
    end if;

    update public.order_items
       set voided_at   = coalesce(voided_at, now()),
           voided_by   = auth.uid(),
           void_reason = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Sin existencias'),
           picked_qty  = 0,
           picked_at   = now(),
           picked_by   = auth.uid(),
           pick_note   = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_item_id;
    -- El disparador de anulación ya devuelve las unidades a la estantería.
  else
    v_sobra := v_item.quantity - p_qty;

    update public.order_items
       set quantity          = p_qty,
           line_total_cents  = v_unidad * p_qty,
           picked_qty        = p_qty,
           picked_at         = now(),
           picked_by         = auth.uid(),
           pick_note         = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_item_id;

    -- Lo que no se recoge no ha salido de la tienda.
    if v_sobra > 0 and v_item.product_id is not null then
      perform public.move_stock(v_item.product_id, 'return', v_sobra,
                                'Sin existencias al preparar', v_item.order_id);
    end if;
  end if;

  perform public.recompute_order_totals(v_item.order_id);

  select * into v_order from public.orders where id = v_item.order_id;
  v_despues := v_order.total_cents;

  -- Si ya estaba cobrado y ahora vale menos, la diferencia es del cliente.
  if v_order.paid_cents > v_despues then
    perform public.refund_order(
      v_item.order_id,
      'Sin existencias al preparar',
      v_order.paid_cents - v_despues,
      coalesce(v_order.paid_method, v_order.payment_method));
  end if;

  return jsonb_build_object(
    'ok', true,
    'total_cents', v_despues,
    'refunded_cents', greatest(v_antes - v_despues, 0));
end;
$$;

grant execute on function public.pick_order_item(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------
-- 4 · Cambiarlo por otro
--
-- La regla de la casa: un cambio nunca sale más caro. Si el sustituto vale más,
-- lo paga la tienda; si vale menos, se cobra lo que vale. Al cliente no se le
-- puede subir el importe por una decisión que no ha tomado él.
-- ---------------------------------------------------------------
create or replace function public.replace_order_item(
  p_item_id    uuid,
  p_product_id uuid,
  p_qty        integer default null,
  p_note       text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    public.order_items;
  v_order   public.orders;
  v_nuevo   public.products;
  v_qty     int;
  v_unidad  int;
  v_tope    int;
  v_despues int;
begin
  select * into v_item from public.order_items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_item.voided_at is not null then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = v_item.order_id;

  if not public.is_staff_of(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;

  select * into v_nuevo from public.products
   where id = p_product_id and restaurant_id = v_order.restaurant_id and is_available;
  if not found then raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0002'; end if;

  v_qty    := greatest(coalesce(p_qty, v_item.quantity), 1);
  v_tope   := v_item.line_total_cents / greatest(v_item.quantity, 1);
  v_unidad := least(v_nuevo.price_cents, v_tope);

  -- Lo pedido vuelve a la estantería y lo llevado sale de ella.
  if v_item.product_id is not null then
    perform public.move_stock(v_item.product_id, 'return', v_item.quantity,
                              'Sustituido al preparar', v_item.order_id);
  end if;
  perform public.move_stock(v_nuevo.id, 'sale', v_qty, 'Sustitución', v_item.order_id);

  update public.order_items
     set replaced_from = coalesce(replaced_from, jsonb_build_object(
           'product_id', v_item.product_id,
           'name', v_item.name_snapshot,
           'quantity', v_item.quantity,
           'unit_price_cents', v_tope)),
         product_id       = v_nuevo.id,
         name_snapshot    = v_nuevo.name,
         image_snapshot   = v_nuevo.image_url,
         unit_price_cents = v_unidad,
         quantity         = v_qty,
         -- Las opciones eran del plato anterior y no viajan con el cambio.
         options            = '[]'::jsonb,
         options_total_cents = 0,
         line_total_cents = v_unidad * v_qty,
         picked_qty       = v_qty,
         picked_at        = now(),
         picked_by        = auth.uid(),
         pick_note        = nullif(btrim(coalesce(p_note, '')), ''),
         tax_rate         = coalesce(nullif(v_nuevo.tax_rate, 0), v_item.tax_rate)
   where id = p_item_id;

  perform public.recompute_order_totals(v_item.order_id);

  select * into v_order from public.orders where id = v_item.order_id;
  v_despues := v_order.total_cents;

  if v_order.paid_cents > v_despues then
    perform public.refund_order(
      v_item.order_id, 'Sustitución al preparar',
      v_order.paid_cents - v_despues,
      coalesce(v_order.paid_method, v_order.payment_method));
  end if;

  return jsonb_build_object('ok', true, 'total_cents', v_despues);
end;
$$;

grant execute on function public.replace_order_item(uuid, uuid, integer, text) to authenticated;
