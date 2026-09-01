-- =============================================================
--  Fase 2 · registro de auditoría del dinero
--
--  `order_events` registra bien los cambios de estado, pero no anota nada
--  económico: ni quién marcó cobrado, ni qué descuento se aplicó a mano, ni un
--  cambio de importe. La auditoría del dinero, que es la que importa cuando
--  falta algo, no existía.
--
--  Los cobros ya son inmutables desde la fase 1 —el libro de movimientos sólo
--  admite altas—, así que lo que falta es lo demás: descuentos, anulaciones,
--  líneas retiradas, cambios de total y arqueos. Se registra en una tabla de
--  sólo añadido que nadie puede modificar ni borrar.
-- =============================================================

create table if not exists public.money_audit (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,

  -- Sobre qué se actuó. Se guarda el identificador suelto y no una clave
  -- foránea con borrado en cascada: si el pedido desaparece, el rastro de que
  -- alguien le quitó cuarenta euros tiene que sobrevivir.
  entity        text not null,   -- order | order_item | cash_session
  entity_id     uuid not null,
  action        text not null,   -- discount | void_item | cancel | total_change | ...

  before_cents  integer,
  after_cents   integer,
  reason        text,

  actor_id      uuid references public.profiles(id) on delete set null,
  actor_role    text,
  created_at    timestamptz not null default now()
);

create index if not exists money_audit_restaurant_idx
  on public.money_audit (restaurant_id, created_at desc);
create index if not exists money_audit_entity_idx
  on public.money_audit (entity, entity_id, created_at);

/**
 * Anota los cambios económicos de un pedido.
 *
 * Va sobre `orders` y no dentro de cada función porque los importes pueden
 * cambiar por varios caminos —una línea anulada recalcula el total, un
 * descuento lo baja— y aquí se ven todos sin tener que acordarse de llamar al
 * registro en cada sitio.
 */
create or replace function public.audit_order_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  select s.role::text into v_rol
    from public.restaurant_staff s
   where s.restaurant_id = new.restaurant_id and s.user_id = auth.uid() and s.is_active
   limit 1;

  if new.manual_discount_cents is distinct from old.manual_discount_cents then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, reason, actor_id, actor_role)
    values (new.restaurant_id, 'order', new.id, 'discount',
            old.manual_discount_cents, new.manual_discount_cents,
            new.discount_reason, auth.uid(), v_rol);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'::order_status then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, reason, actor_id, actor_role)
    values (new.restaurant_id, 'order', new.id, 'cancel',
            old.total_cents, 0, new.cancel_reason, auth.uid(), v_rol);
  end if;

  -- Un total que se mueve sin que cambien las líneas ni el descuento es
  -- exactamente lo que hay que poder revisar después.
  if new.total_cents is distinct from old.total_cents
     and new.manual_discount_cents is not distinct from old.manual_discount_cents
     and new.status is not distinct from old.status then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, actor_id, actor_role)
    values (new.restaurant_id, 'order', new.id, 'total_change',
            old.total_cents, new.total_cents, auth.uid(), v_rol);
  end if;

  return null;
end;
$$;

drop trigger if exists orders_money_audit on public.orders;
create trigger orders_money_audit
  after update on public.orders
  for each row execute function public.audit_order_money();

/** Anota la retirada de una línea de la comanda. */
create or replace function public.audit_item_void()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rest uuid;
  v_rol  text;
begin
  if new.voided_at is null or old.voided_at is not null then
    return null;
  end if;

  select restaurant_id into v_rest from public.orders where id = new.order_id;
  select s.role::text into v_rol
    from public.restaurant_staff s
   where s.restaurant_id = v_rest and s.user_id = auth.uid() and s.is_active
   limit 1;

  insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                  before_cents, after_cents, reason, actor_id, actor_role)
  values (v_rest, 'order_item', new.id, 'void_item',
          new.line_total_cents, 0, new.void_reason, auth.uid(), v_rol);

  return null;
end;
$$;

drop trigger if exists order_items_void_audit on public.order_items;
create trigger order_items_void_audit
  after update on public.order_items
  for each row execute function public.audit_item_void();

/** Anota la apertura y el cierre de caja, con el descuadre si lo hubo. */
create or replace function public.audit_cash_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, reason, actor_id)
    values (new.restaurant_id, 'cash_session', new.id, 'open',
            null, new.opening_float_cents, new.note, auth.uid());
    return null;
  end if;

  if new.status = 'closed' and old.status is distinct from 'closed'::cash_session_status then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, reason, actor_id)
    values (new.restaurant_id, 'cash_session', new.id, 'close',
            new.expected_cents, new.counted_cents,
            case
              when new.variance_cents = 0 then 'Cuadra'
              when new.variance_cents > 0 then format('Sobran %s céntimos', new.variance_cents)
              else format('Faltan %s céntimos', -new.variance_cents)
            end,
            auth.uid());
  end if;

  return null;
end;
$$;

drop trigger if exists cash_sessions_audit on public.cash_sessions;
create trigger cash_sessions_audit
  after insert or update on public.cash_sessions
  for each row execute function public.audit_cash_session();

-- ---------------------------------------------------------------
-- Acceso: se lee, no se escribe.
--
-- Sin políticas de escritura, ni siquiera el dueño puede modificar o borrar
-- una línea del registro desde la aplicación. Un rastro que el interesado
-- puede editar no sirve de rastro.
-- ---------------------------------------------------------------
alter table public.money_audit enable row level security;
alter table public.money_audit force row level security;

drop policy if exists money_audit_read on public.money_audit;
create policy money_audit_read on public.money_audit
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());

grant select on public.money_audit to authenticated;

/** El rastro económico del local, para la pantalla de caja. */
create or replace function public.money_audit_list(
  p_restaurant_id uuid,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'entity', a.entity,
    'entity_id', a.entity_id,
    'action', a.action,
    'before_cents', a.before_cents,
    'after_cents', a.after_cents,
    'reason', a.reason,
    'actor', coalesce(pr.full_name, pr.email, '—'),
    'actor_role', a.actor_role,
    'created_at', a.created_at,
    'order_code', (select o.code from public.orders o where o.id = a.entity_id)
  ) order by a.created_at desc), '[]'::jsonb)
  from (
    select * from public.money_audit
     where restaurant_id = p_restaurant_id
     order by created_at desc
     limit greatest(p_limit, 1)
  ) a
  left join public.profiles pr on pr.id = a.actor_id
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.money_audit_list(uuid, integer) to authenticated;
