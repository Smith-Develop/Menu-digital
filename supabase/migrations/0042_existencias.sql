-- =============================================================
--  Fase 3 · existencias
--
--  La disponibilidad de un plato era un interruptor manual: un producto
--  agotado se seguía vendiendo hasta que alguien se acordaba de apagarlo, y no
--  había recuento, ni consumo por venta, ni aviso de mínimos.
--
--  El control es opcional por producto. La mayoría de una carta de restaurante
--  no se lleva por unidades —no se cuentan los platos de pasta que quedan— y
--  obligar a todos a hacerlo convertiría la carta en un almacén. Se activa
--  donde tiene sentido: la bebida embotellada, el postre del día, la pieza
--  contada.
-- =============================================================

alter table public.products
  add column if not exists track_stock boolean not null default false,
  add column if not exists stock_qty   integer not null default 0,
  add column if not exists low_stock_threshold integer not null default 0;

comment on column public.products.track_stock is
  'Si el plato se lleva por unidades. Falso deja la disponibilidad a mano.';

do $$ begin
  create type stock_movement_kind as enum (
    'sale',        -- consumo por venta
    'return',      -- devuelto al almacén: pedido anulado o línea retirada
    'restock',     -- reposición
    'adjustment',  -- recuento o merma
    'waste'        -- rotura, caducidad
  );
exception when duplicate_object then null; end $$;

/**
 * Historial de existencias.
 *
 * Sin él, "quedan tres" es una afirmación que nadie puede comprobar. Con él se
 * puede reconstruir de dónde salen esas tres unidades, que es lo que convierte
 * un número en un inventario.
 */
create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind          stock_movement_kind not null,
  -- Negativo consume, positivo repone. El signo lo impone el tipo.
  qty           integer not null check (qty <> 0),
  qty_after     integer not null,
  order_id      uuid references public.orders(id) on delete set null,
  reason        text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

/**
 * Mueve las existencias de un plato y deja constancia.
 *
 * Al llegar a cero el plato se retira de la carta solo, que es justo lo que no
 * pasaba: se seguía vendiendo lo que ya no había. Al reponer vuelve, porque
 * dejarlo apagado obligaría a acordarse de encenderlo y estaríamos donde
 * estábamos.
 */
create or replace function public.move_stock(
  p_product_id uuid,
  p_kind       stock_movement_kind,
  p_qty        integer,
  p_reason     text default null,
  p_order_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod  public.products;
  v_delta int;
  v_nuevo int;
begin
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;

  if not v_prod.track_stock then
    return jsonb_build_object('ok', true, 'tracked', false);
  end if;

  v_delta := case
    when p_kind in ('sale', 'waste') then -abs(p_qty)
    when p_kind in ('return', 'restock') then abs(p_qty)
    else p_qty   -- 'adjustment' admite los dos sentidos
  end;

  if v_delta = 0 then
    return jsonb_build_object('ok', true, 'tracked', true, 'stock', v_prod.stock_qty);
  end if;

  -- No se baja de cero. Un inventario en negativo no informa de nada: dice que
  -- la cuenta se perdió en algún punto, y arrastrar ese error es peor que
  -- pararlo aquí.
  v_nuevo := greatest(v_prod.stock_qty + v_delta, 0);

  update public.products
     set stock_qty = v_nuevo,
         is_available = case
           when v_nuevo = 0 then false
           -- Reponer devuelve el plato a la carta. Si el local lo había
           -- apagado a mano por otro motivo, tendrá que volver a apagarlo:
           -- es preferible a que la reposición no sirva de nada.
           when v_prod.stock_qty = 0 and v_nuevo > 0 then true
           else is_available
         end
   where id = p_product_id;

  insert into public.stock_movements (
    product_id, restaurant_id, kind, qty, qty_after, order_id, reason, created_by
  ) values (
    p_product_id, v_prod.restaurant_id, p_kind, v_delta, v_nuevo, p_order_id,
    nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  return jsonb_build_object('ok', true, 'tracked', true, 'stock', v_nuevo,
                            'low', v_nuevo <= v_prod.low_stock_threshold);
end;
$$;

/** Ajuste manual: recuento, merma o reposición, siempre con motivo. */
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_kind       stock_movement_kind,
  p_qty        integer,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest uuid;
begin
  select restaurant_id into v_rest from public.products where id = p_product_id;
  if v_rest is null then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.has_staff_role(v_rest, array['owner','admin','manager']::staff_role[])
     and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'STOCK_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_kind = 'sale' then
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;

  return public.move_stock(p_product_id, p_kind, p_qty, p_reason, null);
end;
$$;

/**
 * El consumo por venta.
 *
 * Va en un disparador sobre las líneas y no dentro de `place_order` porque el
 * pedido puede crearse por varios caminos, y aquí se descuenta una sola vez
 * pase lo que pase por encima.
 */
create or replace function public.consume_stock_on_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is null then return null; end if;
  perform public.move_stock(new.product_id, 'sale', new.quantity, null, new.order_id);
  return null;
end;
$$;

drop trigger if exists order_items_consume_stock on public.order_items;
create trigger order_items_consume_stock
  after insert on public.order_items
  for each row execute function public.consume_stock_on_item();

/** Una línea retirada devuelve su género al almacén. */
create or replace function public.return_stock_on_void()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is null then return null; end if;
  if new.voided_at is null or old.voided_at is not null then return null; end if;
  perform public.move_stock(new.product_id, 'return', new.quantity,
                            coalesce(new.void_reason, 'Línea retirada'), new.order_id);
  return null;
end;
$$;

drop trigger if exists order_items_return_stock on public.order_items;
create trigger order_items_return_stock
  after update on public.order_items
  for each row execute function public.return_stock_on_void();

/** Un pedido anulado devuelve todo lo suyo. */
create or replace function public.return_stock_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linea record;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then return null; end if;

  for v_linea in
    select product_id, quantity from public.order_items
     where order_id = new.id and voided_at is null and product_id is not null
  loop
    perform public.move_stock(v_linea.product_id, 'return', v_linea.quantity,
                              coalesce(new.cancel_reason, 'Pedido anulado'), new.id);
  end loop;

  return null;
end;
$$;

drop trigger if exists orders_return_stock on public.orders;
create trigger orders_return_stock
  after update of status on public.orders
  for each row execute function public.return_stock_on_cancel();

/** Los platos que se están acabando, para el aviso del panel. */
create or replace function public.low_stock(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'stock_qty', p.stock_qty,
    'threshold', p.low_stock_threshold, 'is_available', p.is_available
  ) order by p.stock_qty, p.name), '[]'::jsonb)
  from public.products p
  where p.restaurant_id = p_restaurant_id
    and p.track_stock
    and p.stock_qty <= p.low_stock_threshold
    and (public.is_staff_of(p_restaurant_id) or public.is_superadmin());
$$;

alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;
drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());

grant select on public.stock_movements to authenticated;
grant execute on function public.adjust_stock(uuid, stock_movement_kind, integer, text) to authenticated;
grant execute on function public.low_stock(uuid) to authenticated;
