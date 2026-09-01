-- =============================================================
--  Fase 3 · máquina de estados y operaciones de sala
--
--  `updateOrderStatus` escribía el estado que le mandaran, sin comprobar si la
--  transición tenía sentido: se podía saltar de pendiente a completado, o
--  resucitar un pedido anulado devolviéndolo a preparación. Y como los
--  disparadores sellan las horas de cualquier salto, el histórico quedaba
--  incoherente además de la fila.
--
--  Las transiciones se declaran en una tabla, no en un `case` dentro de una
--  función: así se pueden consultar desde la aplicación para pintar sólo los
--  botones que van a funcionar, y cambiarlas no obliga a tocar código.
-- =============================================================

create table if not exists public.order_transitions (
  from_status order_status not null,
  to_status   order_status not null,
  roles       staff_role[] not null,
  primary key (from_status, to_status)
);

-- El equipo que puede mover la comanda por la cocina, y el que además decide
-- sobre el dinero. Anular está en manos de quien dirige, igual que en la
-- fase 0: es la misma atribución vista desde otro sitio.
insert into public.order_transitions (from_status, to_status, roles) values
  ('pending',    'confirmed',  array['owner','admin','manager','waiter','kitchen','cashier']::staff_role[]),
  ('pending',    'preparing',  array['owner','admin','manager','waiter','kitchen']::staff_role[]),
  ('pending',    'cancelled',  array['owner','admin','manager']::staff_role[]),
  ('confirmed',  'preparing',  array['owner','admin','manager','waiter','kitchen']::staff_role[]),
  ('confirmed',  'ready',      array['owner','admin','manager','waiter','kitchen']::staff_role[]),
  ('confirmed',  'cancelled',  array['owner','admin','manager']::staff_role[]),
  ('preparing',  'ready',      array['owner','admin','manager','waiter','kitchen']::staff_role[]),
  ('preparing',  'cancelled',  array['owner','admin','manager']::staff_role[]),
  ('ready',      'served',     array['owner','admin','manager','waiter']::staff_role[]),
  ('ready',      'delivering', array['owner','admin','manager','waiter','cashier']::staff_role[]),
  ('ready',      'completed',  array['owner','admin','manager','waiter','cashier']::staff_role[]),
  ('ready',      'cancelled',  array['owner','admin','manager']::staff_role[]),
  ('served',     'completed',  array['owner','admin','manager','waiter','cashier']::staff_role[]),
  ('served',     'cancelled',  array['owner','admin','manager']::staff_role[]),
  ('delivering', 'completed',  array['owner','admin','manager','waiter','cashier']::staff_role[]),
  -- La entrega fallida devuelve el pedido al local: no es un retroceso
  -- arbitrario, es la comida que vuelve por la puerta.
  ('delivering', 'ready',      array['owner','admin','manager','waiter','cashier']::staff_role[]),
  ('delivering', 'cancelled',  array['owner','admin','manager']::staff_role[])
on conflict (from_status, to_status) do update set roles = excluded.roles;

alter table public.order_transitions enable row level security;
alter table public.order_transitions force row level security;
drop policy if exists order_transitions_read on public.order_transitions;
create policy order_transitions_read on public.order_transitions
  for select to authenticated using (true);
grant select on public.order_transitions to authenticated;

/**
 * La barrera del dinero pasa a comprobar también el camino.
 *
 * Se añade al mismo disparador y no a otro aparte para que el orden entre las
 * dos comprobaciones sea evidente: primero si el salto existe, después si hay
 * dinero para cerrarlo.
 */
create or replace function public.guard_order_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permitido staff_role[];
  v_rol       staff_role;
begin
  if auth.uid() is null then
    return new;
  end if;

  if coalesce(current_setting('app.recomputing_payments', true), 'off') = 'on' then
    return new;
  end if;

  -- ---- El camino ----
  if new.status is distinct from old.status then
    -- El repartidor asignado mueve su propio pedido a través de sus funciones,
    -- que ya comprueban que sea suyo. No es del equipo del local, así que la
    -- tabla de roles no le aplica.
    if new.courier_id is not null and new.courier_id = public.my_courier_id() then
      null;
    elsif public.is_superadmin() then
      null;
    else
      select roles into v_permitido from public.order_transitions
       where from_status = old.status and to_status = new.status;

      if v_permitido is null then
        raise exception 'INVALID_TRANSITION:%->%', old.status, new.status using errcode = 'P0001';
      end if;

      select s.role into v_rol from public.restaurant_staff s
       where s.restaurant_id = new.restaurant_id and s.user_id = auth.uid() and s.is_active
       limit 1;

      -- El dueño puede no tener fila de equipo: la propiedad del local ya le
      -- da el papel, igual que en `has_staff_role`.
      if v_rol is null and exists (
        select 1 from public.restaurants r where r.id = new.restaurant_id and r.owner_id = auth.uid()
      ) then
        v_rol := 'owner';
      end if;

      if v_rol is null or not (v_rol = any(v_permitido)) then
        raise exception 'ROLE_CANNOT_TRANSITION:%', coalesce(v_rol::text, 'sin rol') using errcode = '42501';
      end if;
    end if;
  end if;

  -- ---- El dinero ----
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
-- 2 · Traspaso y unión de mesas
--
-- Mover una comanda de la 4 a la 7, o juntar dos mesas en una cuenta. Son
-- operaciones de sala de todos los días que obligaban a anular y volver a
-- pedir, con lo que eso supone para la cocina y para el histórico.
-- ---------------------------------------------------------------

/** Mueve un pedido a otra mesa del mismo restaurante. */
create or replace function public.transfer_order_to_table(
  p_order_id uuid,
  p_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_mesa   public.tables;
  v_origen uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_charge(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_order.payment_status = 'paid' or v_order.status in ('completed', 'cancelled') then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;

  select * into v_mesa from public.tables where id = p_table_id and is_active;
  if not found then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Entre locales no: la cuenta pertenece al restaurante que la sirve.
  if v_mesa.restaurant_id <> v_order.restaurant_id then
    raise exception 'TABLE_OTHER_RESTAURANT' using errcode = 'P0001';
  end if;

  v_origen := v_order.table_id;
  update public.orders set table_id = p_table_id where id = p_order_id;

  return jsonb_build_object('ok', true, 'from_table_id', v_origen, 'to_table_id', p_table_id);
end;
$$;

/**
 * Junta dos mesas: todo lo abierto de la primera pasa a la segunda.
 *
 * El turno de la mesa de origen se renueva, porque para sus comensales esa mesa
 * ya no tiene cuenta: si conservara el turno seguirían viendo una cuenta que se
 * está pagando en otro sitio.
 */
create or replace function public.merge_tables(
  p_from_table uuid,
  p_to_table   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest uuid;
  v_n    int;
begin
  if p_from_table = p_to_table then
    raise exception 'SAME_TABLE' using errcode = 'P0001';
  end if;

  select restaurant_id into v_rest from public.tables where id = p_from_table and is_active;
  if v_rest is null then raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_charge(v_rest) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tables
                  where id = p_to_table and restaurant_id = v_rest and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.orders
     set table_id = p_to_table
   where table_id = p_from_table
     and status <> 'cancelled'
     and payment_status <> 'paid';
  get diagnostics v_n = row_count;

  -- Los comensales no se tocan: cada comanda conserva los suyos y la sala los
  -- suma al pintar la mesa. Sumarlos aquí los contaría dos veces.

  update public.tables
     set session_id = gen_random_uuid(), assigned_waiter_id = null, assigned_at = null
   where id = p_from_table;

  return jsonb_build_object('ok', true, 'orders', v_n);
end;
$$;

/** Número de comensales de una comanda. */
create or replace function public.set_order_covers(
  p_order_id uuid,
  p_covers   integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.can_charge(v_order.restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.orders
     set covers = nullif(greatest(coalesce(p_covers, 0), 0), 0)
   where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.transfer_order_to_table(uuid, uuid) to authenticated;
grant execute on function public.merge_tables(uuid, uuid) to authenticated;
grant execute on function public.set_order_covers(uuid, integer) to authenticated;

-- ---------------------------------------------------------------
-- 3 · La sala enseña los comensales
-- ---------------------------------------------------------------
create or replace function public.floor_status(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'code', t.code,
      'seats', t.seats,
      'waiter_id', t.assigned_waiter_id,
      'waiter_name', p.full_name,
      'assigned_at', t.assigned_at,
      'covers', (select sum(o.covers) from public.orders o
                  where o.table_id = t.id and o.status <> 'cancelled'
                    and o.payment_status <> 'paid'),
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'code', o.code,
          'status', o.status,
          'payment_status', o.payment_status,
          'total_cents', o.total_cents,
          'paid_cents', o.paid_cents,
          'covers', o.covers,
          'created_at', o.created_at) order by o.created_at)
        from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), '[]'::jsonb),
      'total_cents', coalesce((
        select sum(o.total_cents) from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), 0),
      'due_cents', coalesce((
        select sum(greatest(o.total_cents - o.paid_cents, 0)) from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), 0),
      'pending_calls', coalesce((
        select count(*) from public.waiter_calls w
        where w.table_id = t.id and w.attended_at is null), 0)
    ) as x
    from public.tables t
    left join public.profiles p on p.id = t.assigned_waiter_id
    where t.restaurant_id = p_restaurant_id
      and t.is_active
  ) s
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.floor_status(uuid) to authenticated;
