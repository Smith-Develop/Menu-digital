-- =============================================================
--  Fase 1 de la auditoría · el ciclo económico
--
--  Hasta ahora el cobro era una palabra en el pedido: pagado o pendiente. Con
--  eso no se puede dividir una cuenta, ni cobrar la mitad en efectivo y la
--  mitad con tarjeta, ni devolver dinero, porque todo eso son *varios*
--  movimientos sobre la misma venta y sólo había sitio para uno.
--
--  Esta migración separa el pedido —lo que se prepara y se entrega— de los
--  movimientos de dinero, que pasan a ser apuntes con signo, irrevocables, cada
--  uno con su medio, su importe, su hora y su responsable. Un pedido tiene
--  muchos cobros; una devolución es un apunte negativo, nunca un borrado.
--
--  `orders.payment_status` deja de escribirse a mano: se deriva de la suma.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · El libro de movimientos
-- ---------------------------------------------------------------
do $$ begin
  create type payment_entry_kind as enum ('charge', 'refund');
exception when duplicate_object then null; end $$;

create table if not exists public.order_payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  -- Desnormalizado a propósito: las políticas de acceso y el arqueo por local
  -- lo consultan en cada fila, y subir hasta `orders` para saber de quién es
  -- cada apunte encarece justo la consulta más frecuente.
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,

  kind          payment_entry_kind not null default 'charge',
  -- Positivo cobra, negativo devuelve. El signo lo impone un disparador a
  -- partir de `kind`, para que no puedan discrepar.
  amount_cents  integer not null check (amount_cents <> 0),
  method        payment_method not null,

  -- Qué se cobró o por qué se devolvió. En una cuenta dividida es lo que
  -- distingue un apunte de otro: "comensal 2", "los dos entrantes".
  note          text,
  reason        text,

  -- Quién lo hizo. Si lo cobró el repartidor en la puerta, queda su ficha:
  -- es lo que convierte ese dinero en deuda suya hasta que lo liquida.
  created_by    uuid references public.profiles(id) on delete set null,
  courier_id    uuid references public.couriers(id) on delete set null,

  cash_settled_at timestamptz,
  cash_settled_by uuid references public.profiles(id) on delete set null,

  created_at    timestamptz not null default now()
);

create index if not exists order_payments_order_idx on public.order_payments (order_id, created_at);
create index if not exists order_payments_restaurant_idx on public.order_payments (restaurant_id, created_at desc);
-- El efectivo que un repartidor lleva encima sin devolver: la consulta del
-- arqueo diario, y la única que se hace muchas veces al día.
create index if not exists order_payments_cash_due_idx
  on public.order_payments (courier_id, restaurant_id)
  where method = 'cash' and kind = 'charge' and cash_settled_at is null and courier_id is not null;

-- El signo lo decide el tipo de apunte, no quien lo inserta.
create or replace function public.sign_payment_entry()
returns trigger language plpgsql as $$
begin
  new.amount_cents := case
    when new.kind = 'refund' then -abs(new.amount_cents)
    else abs(new.amount_cents)
  end;
  return new;
end $$;

drop trigger if exists order_payments_sign on public.order_payments;
create trigger order_payments_sign
  before insert or update on public.order_payments
  for each row execute function public.sign_payment_entry();

-- ---------------------------------------------------------------
-- 2 · El pedido lleva la cuenta de lo cobrado
--
-- `payment_status` se queda —lo leen muchas pantallas— pero deja de escribirse
-- a mano: pasa a derivarse de los apuntes. Al lado van los importes, que son
-- los que permiten hablar de una cuenta a medias, cosa que un enumerado de
-- cuatro valores no sabía expresar.
-- ---------------------------------------------------------------
alter table public.orders
  add column if not exists paid_cents             integer not null default 0,
  add column if not exists refunded_cents         integer not null default 0,
  add column if not exists manual_discount_cents  integer not null default 0,
  add column if not exists discount_reason        text,
  add column if not exists discount_by            uuid references public.profiles(id) on delete set null,
  add column if not exists delivery_failed_at     timestamptz,
  add column if not exists delivery_failed_reason text;

alter table public.order_items
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references public.profiles(id) on delete set null,
  add column if not exists void_reason text;

/**
 * Recalcula lo cobrado de un pedido a partir de sus apuntes.
 *
 * Se salta la barrera de la migración 0035 con una marca de transacción: el
 * permiso ya se comprobó al crear el apunte, y volver a exigirlo aquí impediría
 * que el repartidor cobrase o que una devolución cerrase su propio círculo.
 */
create or replace function public.recompute_order_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pagado    int;
  v_devuelto  int;
  v_total     int;
  v_estado    payment_status;
begin
  select coalesce(sum(amount_cents), 0),
         coalesce(sum(case when kind = 'refund' then -amount_cents else 0 end), 0)
    into v_pagado, v_devuelto
    from public.order_payments where order_id = p_order_id;

  select total_cents into v_total from public.orders where id = p_order_id;

  v_estado := case
    -- Una cuenta con devolución es una cuenta devuelta, aunque quede saldo:
    -- lo que falta lo cuentan los importes, y llamarla "pendiente" la metería
    -- entre las que hay que salir a cobrar.
    when v_devuelto > 0 then 'refunded'
    when v_total > 0 and v_pagado >= v_total then 'paid'
    else 'pending'
  end::payment_status;

  perform set_config('app.recomputing_payments', 'on', true);

  update public.orders
     set paid_cents     = v_pagado,
         refunded_cents = v_devuelto,
         payment_status = v_estado,
         paid_at = case when v_estado = 'paid' then coalesce(paid_at, now()) else paid_at end
   where id = p_order_id;

  perform set_config('app.recomputing_payments', 'off', true);
end;
$$;

create or replace function public.touch_order_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_order_payment(coalesce(new.order_id, old.order_id));
  return null;
end $$;

drop trigger if exists order_payments_recompute on public.order_payments;
create trigger order_payments_recompute
  after insert or update or delete on public.order_payments
  for each row execute function public.touch_order_payment();

-- La barrera de la 0035 reconoce ahora el recálculo y lo deja pasar.
create or replace function public.guard_order_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- El recálculo derivado de los apuntes ya viene autorizado: el permiso se
  -- comprobó al crear el apunte, que es donde se decide de verdad.
  if coalesce(current_setting('app.recomputing_payments', true), 'off') = 'on' then
    return new;
  end if;

  if new.payment_status is distinct from old.payment_status
     or new.paid_at is distinct from old.paid_at
     or new.paid_method is distinct from old.paid_method then
    if not public.can_charge(new.restaurant_id)
       and not public.is_superadmin()
       and (new.courier_id is null or new.courier_id is distinct from public.my_courier_id()) then
      raise exception 'FORBIDDEN_CHARGE' using errcode = '42501';
    end if;
  end if;

  if new.cash_settled_at is distinct from old.cash_settled_at then
    if not public.can_charge(new.restaurant_id) and not public.is_superadmin() then
      raise exception 'FORBIDDEN_SETTLE' using errcode = '42501';
    end if;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed'::order_status
     and new.payment_status <> 'paid' then
    raise exception 'PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'::order_status then
    if not public.can_cancel_orders(new.restaurant_id) and not public.is_superadmin() then
      raise exception 'FORBIDDEN_CANCEL' using errcode = '42501';
    end if;
    if coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'CANCEL_REASON_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 3 · Cobrar, entero o a trozos
-- ---------------------------------------------------------------

/**
 * Añade un cobro a una cuenta.
 *
 * `p_amount_cents` nulo cobra lo que falte, que es el caso normal. Con importe
 * se cobra una parte: es lo que permite dividir la cuenta entre comensales, o
 * pagar la mitad en efectivo y la otra mitad con tarjeta.
 *
 * No se admite cobrar de más. Un cobro que se pasa del total casi siempre es un
 * doble cobro por dos personas atendiendo la misma mesa, y es mejor negarse que
 * tener que devolver dinero después.
 */
create or replace function public.add_order_payment(
  p_order_id     uuid,
  p_method       payment_method default null,
  p_amount_cents integer default null,
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders;
  v_falta   int;
  v_importe int;
  v_courier uuid := public.my_courier_id();
  v_suyo    boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  v_suyo := v_order.courier_id is not null and v_order.courier_id = v_courier;

  if not public.can_charge(v_order.restaurant_id) and not public.is_superadmin() and not v_suyo then
    raise exception 'FORBIDDEN_CHARGE' using errcode = '42501';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = 'P0001';
  end if;

  v_falta := v_order.total_cents - v_order.paid_cents;
  if v_falta <= 0 then
    return jsonb_build_object('ok', true, 'already', true, 'paid_cents', v_order.paid_cents,
                              'due_cents', 0);
  end if;

  v_importe := coalesce(p_amount_cents, v_falta);
  if v_importe <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if v_importe > v_falta then raise exception 'OVERPAYMENT' using errcode = 'P0001'; end if;

  insert into public.order_payments (
    order_id, restaurant_id, kind, amount_cents, method, note, created_by,
    courier_id
  ) values (
    p_order_id, v_order.restaurant_id, 'charge', v_importe,
    coalesce(p_method, v_order.payment_method), nullif(btrim(coalesce(p_note,'')), ''),
    auth.uid(), case when v_suyo then v_courier else null end
  );

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'ok', true, 'already', false,
    'charged_cents', v_importe,
    'paid_cents', v_order.paid_cents,
    'due_cents', greatest(v_order.total_cents - v_order.paid_cents, 0),
    'fully_paid', v_order.payment_status = 'paid'
  );
end;
$$;

/**
 * Cobra la cuenta entera de una mesa en un gesto.
 *
 * Una mesa con cinco comandas exigía cinco confirmaciones seguidas. El importe
 * se reparte entre las comandas abiertas empezando por la más antigua, que es
 * el orden en el que se consumieron.
 */
create or replace function public.pay_table_bill(
  p_table_id     uuid,
  p_method       payment_method default 'cash',
  p_amount_cents integer default null,
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest    uuid;
  v_pedido  record;
  v_resta   int;
  v_falta   int;
  v_aplica  int;
  v_total   int := 0;
  v_n       int := 0;
begin
  select restaurant_id into v_rest from public.tables where id = p_table_id;
  if v_rest is null then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_charge(v_rest) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_CHARGE' using errcode = '42501';
  end if;

  select coalesce(sum(total_cents - paid_cents), 0) into v_resta
    from public.orders
   where table_id = p_table_id and status <> 'cancelled' and payment_status <> 'paid';

  if v_resta <= 0 then
    return jsonb_build_object('ok', true, 'orders', 0, 'charged_cents', 0, 'due_cents', 0);
  end if;

  v_resta := least(coalesce(p_amount_cents, v_resta), v_resta);
  if v_resta <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  for v_pedido in
    select id, total_cents, paid_cents from public.orders
     where table_id = p_table_id and status <> 'cancelled' and payment_status <> 'paid'
     order by created_at
     for update
  loop
    exit when v_resta <= 0;
    v_falta := v_pedido.total_cents - v_pedido.paid_cents;
    continue when v_falta <= 0;

    v_aplica := least(v_falta, v_resta);
    perform public.add_order_payment(v_pedido.id, p_method, v_aplica, p_note);

    v_resta := v_resta - v_aplica;
    v_total := v_total + v_aplica;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object(
    'ok', true, 'orders', v_n, 'charged_cents', v_total,
    'due_cents', (select coalesce(sum(total_cents - paid_cents), 0) from public.orders
                   where table_id = p_table_id and status <> 'cancelled' and payment_status <> 'paid')
  );
end;
$$;

/**
 * Cuenta de mesa con el detalle de lo ya cobrado.
 *
 * Sustituye a la anterior, que devolvía un total único y por eso no se podía
 * dividir: ahora cada comanda dice cuánto lleva pagado y cuánto le falta.
 */
create or replace function public.table_bill(p_table_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'table', jsonb_build_object('id', t.id, 'name', t.name, 'code', t.code),
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
        'paid_cents', o.paid_cents,
        'due_cents', greatest(o.total_cents - o.paid_cents, 0),
        'discount_cents', o.discount_cents,
        'manual_discount_cents', o.manual_discount_cents,
        'coupon_code', o.coupon_code,
        'created_at', o.created_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', i.id,
            'name', i.name_snapshot, 'quantity', i.quantity,
            'line_total_cents', i.line_total_cents,
            'options', i.options) order by i.created_at), '[]'::jsonb)
          from public.order_items i where i.order_id = o.id and i.voided_at is null)
      ) order by o.created_at)
      from public.orders o
      where o.table_id = t.id
        and o.status <> 'cancelled'
        and o.payment_status <> 'paid'
    ), '[]'::jsonb),
    'total_cents', coalesce((
      select sum(o.total_cents) from public.orders o
      where o.table_id = t.id and o.status <> 'cancelled' and o.payment_status <> 'paid'
    ), 0),
    'due_cents', coalesce((
      select sum(greatest(o.total_cents - o.paid_cents, 0)) from public.orders o
      where o.table_id = t.id and o.status <> 'cancelled' and o.payment_status <> 'paid'
    ), 0)
  )
  from public.tables t
  join public.restaurants r on r.id = t.restaurant_id
  where t.code = p_table_code and t.is_active;
$$;

-- ---------------------------------------------------------------
-- 4 · Devolver
--
-- La primera vez que este sistema puede sacar dinero de la caja. No se toca el
-- cobro original: se añade un apunte negativo enlazado a la misma cuenta, que
-- es lo que permite que las dos cosas —lo que entró y lo que salió— sigan
-- siendo ciertas a la vez.
--
-- El documento de abono con numeración fiscal es de la fase 3; esto es su
-- contenido económico, que es lo que hacía falta ya.
-- ---------------------------------------------------------------
create or replace function public.refund_order(
  p_order_id     uuid,
  p_reason       text,
  p_amount_cents integer default null,
  p_method       payment_method default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   public.orders;
  v_motivo  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_importe int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Devolver reduce la venta del día, así que responde quien dirige el local.
  if not public.can_cancel_orders(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_REFUND' using errcode = '42501';
  end if;

  if v_motivo is null then
    raise exception 'REFUND_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_order.paid_cents <= 0 then
    raise exception 'NOTHING_TO_REFUND' using errcode = 'P0001';
  end if;

  v_importe := coalesce(p_amount_cents, v_order.paid_cents);
  if v_importe <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if v_importe > v_order.paid_cents then
    raise exception 'REFUND_EXCEEDS_PAID' using errcode = 'P0001';
  end if;

  insert into public.order_payments (
    order_id, restaurant_id, kind, amount_cents, method, reason, created_by
  ) values (
    p_order_id, v_order.restaurant_id, 'refund', v_importe,
    -- Por defecto se devuelve por donde se cobró: es lo que espera el cliente
    -- y lo que cuadra la caja.
    coalesce(p_method, v_order.paid_method, v_order.payment_method),
    v_motivo, auth.uid()
  );

  select * into v_order from public.orders where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'refunded_cents', v_importe,
    'paid_cents', v_order.paid_cents,
    'total_refunded_cents', v_order.refunded_cents
  );
end;
$$;

-- ---------------------------------------------------------------
-- 5 · Anular una línea
--
-- Quitar un plato de una comanda ya enviada, corregir una cantidad, invitar a
-- algo concreto. Antes la única salida era anular el pedido entero, que además
-- dejaba de poder hacerse en cuanto la cocina empezaba.
-- ---------------------------------------------------------------

/**
 * Recalcula los totales de un pedido a partir de sus líneas vivas.
 *
 * El descuento del cupón se escala en proporción a lo que queda: si se anula la
 * mitad del pedido, se conserva la mitad del descuento. Es una decisión
 * discutible —el cupón se concedió sobre otra cesta— pero cualquier otra
 * penaliza al cliente por un error del local o le regala más de la cuenta.
 */
create or replace function public.recompute_order_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_rest     public.restaurants;
  v_sub      int;
  v_sub_ini  int;
  v_cupon    int;
  v_desc     int;
  v_base     int;
  v_tax      int;
begin
  select * into v_order from public.orders where id = p_order_id;
  select * into v_rest from public.restaurants where id = v_order.restaurant_id;

  select coalesce(sum(line_total_cents), 0) into v_sub
    from public.order_items where order_id = p_order_id and voided_at is null;
  select coalesce(sum(line_total_cents), 0) into v_sub_ini
    from public.order_items where order_id = p_order_id;

  -- El descuento de cupón guardado corresponde a la cesta completa.
  v_cupon := case
    when v_sub_ini > 0 then round(v_order.discount_cents::numeric * v_sub / v_sub_ini)::int
    else 0
  end;

  v_desc := least(v_cupon + v_order.manual_discount_cents, v_sub);
  v_base := greatest(v_sub - v_desc, 0);
  v_tax  := round(v_base * v_rest.tax_rate)::int;

  update public.orders
     set subtotal_cents = v_sub,
         discount_cents = v_cupon,
         tax_cents      = v_tax,
         total_cents    = greatest(v_base + v_tax + delivery_fee_cents + tip_cents, 0)
   where id = p_order_id;

  -- El total ha cambiado: lo cobrado puede haber pasado a cubrirlo entero.
  perform public.recompute_order_payment(p_order_id);
end;
$$;

create or replace function public.void_order_item(
  p_item_id uuid,
  p_reason  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item   public.order_items;
  v_order  public.orders;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
  v_vivas  int;
begin
  select * into v_item from public.order_items where id = p_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_order from public.orders where id = v_item.order_id;

  if not public.can_cancel_orders(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_VOID' using errcode = '42501';
  end if;

  if v_motivo is null then
    raise exception 'VOID_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_item.voided_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Sobre una cuenta ya cobrada esto no es anular, es devolver.
  if v_order.paid_cents > 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  select count(*) into v_vivas
    from public.order_items where order_id = v_item.order_id and voided_at is null;
  if v_vivas <= 1 then
    -- Quitar la última línea deja un pedido vacío, que no es una comanda
    -- corregida sino una anulada. Que lo diga quien la anula.
    raise exception 'LAST_ITEM' using errcode = 'P0001';
  end if;

  update public.order_items
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_motivo
   where id = p_item_id;

  perform public.recompute_order_totals(v_item.order_id);

  select * into v_order from public.orders where id = v_item.order_id;
  return jsonb_build_object('ok', true, 'already', false, 'total_cents', v_order.total_cents);
end;
$$;

-- ---------------------------------------------------------------
-- 6 · Descuento de la casa
--
-- La invitación, el plato que sale mal, la compensación al cliente enfadado.
-- Operaciones diarias en cualquier local que hasta ahora no tenían dónde
-- anotarse: sólo se podía descontar con un cupón creado de antemano.
-- ---------------------------------------------------------------
create or replace function public.apply_manual_discount(
  p_order_id uuid,
  p_cents    integer,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_cancel_orders(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_DISCOUNT' using errcode = '42501';
  end if;

  if v_motivo is null then
    raise exception 'DISCOUNT_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_cents < 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  if v_order.paid_cents > 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  if p_cents > v_order.subtotal_cents then
    raise exception 'DISCOUNT_EXCEEDS_ORDER' using errcode = 'P0001';
  end if;

  update public.orders
     set manual_discount_cents = p_cents,
         discount_reason = v_motivo,
         discount_by = auth.uid()
   where id = p_order_id;

  perform public.recompute_order_totals(p_order_id);

  select * into v_order from public.orders where id = p_order_id;
  return jsonb_build_object('ok', true, 'total_cents', v_order.total_cents,
                            'discount_cents', v_order.manual_discount_cents);
end;
$$;

-- ---------------------------------------------------------------
-- 7 · Entrega fallida
--
-- El cliente no aparece, la dirección no existe. No había forma de decirlo, así
-- que el pedido se quedaba en reparto para siempre ocupando el panel.
--
-- La comida vuelve al local: el pedido regresa a "listo" y se suelta al
-- repartidor. Desde ahí el restaurante decide —reintentar con otro, o anular—,
-- que es una decisión suya y no del repartidor en la calle.
-- ---------------------------------------------------------------
create or replace function public.courier_fail_delivery(
  p_order_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_motivo text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.courier_id is distinct from public.my_courier_id()
     and not public.can_charge(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'NOT_YOUR_ORDER' using errcode = '42501';
  end if;

  if v_motivo is null then
    raise exception 'FAIL_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_order.status not in ('ready', 'delivering') then
    raise exception 'ORDER_NOT_IN_DELIVERY' using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'ready',
         courier_id = null,
         picked_up_at = null,
         delivery_failed_at = now(),
         delivery_failed_reason = v_motivo
   where id = p_order_id;

  update public.couriers
     set status = case
           when exists (select 1 from public.orders
                        where courier_id = v_order.courier_id and status = 'delivering')
           then 'busy'::courier_status else 'available'::courier_status
         end
   where id = v_order.courier_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------
-- 8 · La entrega del repartidor pasa por el libro de movimientos
-- ---------------------------------------------------------------
create or replace function public.courier_deliver_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_cash  int := 0;
  v_falta int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_order.courier_id is distinct from public.my_courier_id() then
    raise exception 'NOT_YOUR_ORDER' using errcode = '42501';
  end if;

  if v_order.status = 'completed' then
    raise exception 'ALREADY_DELIVERED' using errcode = 'P0001';
  end if;

  if v_order.status not in ('ready', 'delivering') then
    raise exception 'ORDER_NOT_READY' using errcode = 'P0001';
  end if;

  -- Todo pedido que se entrega se cobra en la puerta: no existe el pago en
  -- línea. El apunte queda a nombre del repartidor sea cual sea el medio, que
  -- es lo que faltaba para saber que había cobrado con datáfono.
  v_falta := v_order.total_cents - v_order.paid_cents;
  if v_falta > 0 then
    perform public.add_order_payment(p_order_id, v_order.payment_method, v_falta, null);
    if v_order.payment_method = 'cash' then v_cash := v_falta; end if;
  end if;

  update public.orders
     set status       = 'completed',
         completed_at = coalesce(completed_at, now()),
         picked_up_at = coalesce(picked_up_at, now()),
         paid_method  = coalesce(paid_method, v_order.payment_method)
   where id = p_order_id;

  update public.couriers
     set deliveries_count = deliveries_count + 1,
         status = case
           when exists (select 1 from public.orders
                        where courier_id = v_order.courier_id and status = 'delivering')
           then 'busy'::courier_status else 'available'::courier_status
         end
   where id = v_order.courier_id;

  return jsonb_build_object('ok', true, 'cash_cents', v_cash);
end;
$$;

-- El efectivo del repartidor sale ahora de los apuntes, no de los pedidos: así
-- un cobro con datáfono deja de contar como dinero que debe traer, que era el
-- caso que se perdía.
create or replace function public.courier_cash_due(p_courier_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'restaurant_id', r.id,
    'restaurant_name', r.name,
    'orders', x.pedidos,
    'cents', x.cents
  ) order by r.name), '[]'::jsonb)
  from (
    select p.restaurant_id,
           count(distinct p.order_id)::int as pedidos,
           sum(p.amount_cents)::int as cents
    from public.order_payments p
    where p.courier_id = coalesce(p_courier_id, public.my_courier_id())
      and p.method = 'cash'
      and p.kind = 'charge'
      and p.cash_settled_at is null
    group by p.restaurant_id
  ) x
  join public.restaurants r on r.id = x.restaurant_id;
$$;

drop function if exists public.settle_courier_cash(uuid, uuid);

create or replace function public.settle_courier_cash(
  p_courier_id    uuid,
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedidos int;
  v_cents   int;
begin
  if not public.can_charge(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN_SETTLE' using errcode = '42501';
  end if;

  select count(distinct order_id)::int, coalesce(sum(amount_cents), 0)::int
    into v_pedidos, v_cents
    from public.order_payments
   where restaurant_id = p_restaurant_id and courier_id = p_courier_id
     and method = 'cash' and kind = 'charge' and cash_settled_at is null;

  update public.order_payments
     set cash_settled_at = now(), cash_settled_by = auth.uid()
   where restaurant_id = p_restaurant_id and courier_id = p_courier_id
     and method = 'cash' and kind = 'charge' and cash_settled_at is null;

  return jsonb_build_object('ok', true, 'orders', v_pedidos, 'cents', v_cents);
end;
$$;

-- `mark_order_paid` se conserva porque la usa el panel, pero ahora es un atajo
-- sobre el libro de movimientos: cobrar lo que falte de una vez.
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_method   payment_method default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  v_res := public.add_order_payment(p_order_id, p_method, null, null);
  update public.orders set paid_method = coalesce(p_method, paid_method, payment_method)
   where id = p_order_id;
  return v_res || jsonb_build_object('already', v_res->'already');
end;
$$;

-- ---------------------------------------------------------------
-- 9 · Acceso al libro de movimientos
--
-- Se lee, no se escribe: los apuntes sólo entran por las funciones de arriba,
-- que son las que comprueban quién puede hacer qué. Sin política de escritura,
-- nadie puede inventarse un cobro ni borrar uno hecho.
-- ---------------------------------------------------------------
alter table public.order_payments enable row level security;
alter table public.order_payments force row level security;

drop policy if exists order_payments_read on public.order_payments;
create policy order_payments_read on public.order_payments
  for select to authenticated
  using (
    public.is_staff_of(restaurant_id)
    or public.is_superadmin()
    or exists (select 1 from public.orders o
               where o.id = order_id and o.customer_id = auth.uid())
    or courier_id = public.my_courier_id()
  );

grant select on public.order_payments to authenticated;

grant execute on function public.add_order_payment(uuid, payment_method, integer, text) to authenticated;
grant execute on function public.pay_table_bill(uuid, payment_method, integer, text) to authenticated;
grant execute on function public.refund_order(uuid, text, integer, payment_method) to authenticated;
grant execute on function public.void_order_item(uuid, text) to authenticated;
grant execute on function public.apply_manual_discount(uuid, integer, text) to authenticated;
grant execute on function public.courier_fail_delivery(uuid, text) to authenticated;
grant execute on function public.settle_courier_cash(uuid, uuid) to authenticated;
grant execute on function public.table_bill(text) to anon, authenticated;

-- ---------------------------------------------------------------
-- 10 · Traspaso de lo ya cobrado
--
-- Los pedidos que ya constaban como pagados necesitan su apunte, o el saldo
-- derivado los dejaría a cero y volverían a aparecer como pendientes de cobro.
-- ---------------------------------------------------------------
insert into public.order_payments (
  order_id, restaurant_id, kind, amount_cents, method, note, created_by, courier_id,
  cash_settled_at, cash_settled_by, created_at
)
select o.id, o.restaurant_id, 'charge', o.total_cents,
       coalesce(o.paid_method, o.payment_method),
       'Traspaso del histórico',
       o.paid_by, o.courier_id,
       o.cash_settled_at, o.cash_settled_by,
       coalesce(o.paid_at, o.completed_at, o.created_at)
from public.orders o
where o.payment_status = 'paid'
  and o.total_cents > 0
  and not exists (select 1 from public.order_payments p where p.order_id = o.id);

-- El disparador ya ha puesto `paid_cents` al día en cada inserción; esto cubre
-- los pedidos sin apuntes, que deben quedar explícitamente a cero.
update public.orders set paid_cents = 0, refunded_cents = 0
 where not exists (select 1 from public.order_payments p where p.order_id = orders.id)
   and paid_cents <> 0;
