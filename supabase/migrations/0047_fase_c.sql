-- =============================================================
--  Fase C · cobrar por lo que se vende
--
--  Todo el ingreso de la plataforma era fijo: la cuota. No ganaba más porque un
--  local vendiera más, ni menos porque vendiera poco. En un marketplace de
--  reparto la comisión suele ser la fuente principal y la cuota el complemento.
--
--  La comisión no se calcula al vuelo sobre los pedidos: se devenga como
--  apuntes, igual que los cobros. Cada línea guarda la tarifa que se le aplicó,
--  así que subir la comisión mañana no reescribe lo devengado ayer. Y una
--  devolución genera su línea negativa, de modo que la plataforma no cobra
--  comisión de una venta que se deshizo.
-- =============================================================

alter table public.plans
  add column if not exists commission_rate numeric(5,4) not null default 0;

comment on column public.plans.commission_rate is
  'Comisión sobre lo cobrado. 0.10 = 10%. Cero deja el plan a cuota fija.';

-- ---------------------------------------------------------------
-- 1 · El libro de comisiones
-- ---------------------------------------------------------------
create table if not exists public.platform_commissions (
  id            uuid primary key default gen_random_uuid(),

  subject_type  subscription_subject not null,
  subject_id    uuid not null,
  -- Se guarda aparte del sujeto para poder agrupar por local también cuando la
  -- comisión es del repartidor: el dinero se generó en ese restaurante.
  restaurant_id uuid references public.restaurants(id) on delete set null,

  order_id      uuid references public.orders(id) on delete set null,
  payment_id    uuid references public.order_payments(id) on delete set null,

  base_cents    integer not null,
  -- Congelada al devengar. Sin esto, cambiar la tarifa reescribiría el pasado.
  rate          numeric(5,4) not null,
  -- Con signo: la devolución de una venta devuelve también su comisión.
  amount_cents  integer not null,
  currency      char(3) not null default 'EUR',

  settlement_id uuid,
  created_at    timestamptz not null default now()
);

create index if not exists platform_commissions_subject_idx
  on public.platform_commissions (subject_type, subject_id, created_at desc);
create index if not exists platform_commissions_pending_idx
  on public.platform_commissions (subject_type, subject_id)
  where settlement_id is null;

create table if not exists public.platform_settlements (
  id            uuid primary key default gen_random_uuid(),
  subject_type  subscription_subject not null,
  subject_id    uuid not null,
  lines         integer not null default 0,
  amount_cents  integer not null default 0,
  currency      char(3) not null default 'EUR',
  note          text,
  settled_at    timestamptz not null default now(),
  settled_by    uuid references public.profiles(id) on delete set null
);

create index if not exists platform_settlements_subject_idx
  on public.platform_settlements (subject_type, subject_id, settled_at desc);

-- ---------------------------------------------------------------
-- 2 · La tarifa vigente de cada sujeto
-- ---------------------------------------------------------------
create or replace function public.commission_rate_for(
  p_subject_type subscription_subject,
  p_subject_id   uuid
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select pl.commission_rate
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.subject_type = p_subject_type
      and s.subject_id = p_subject_id
      and s.status in ('trialing', 'active', 'past_due')
      and s.current_period_end > now()
    order by s.created_at desc
    limit 1
  ), 0);
$$;

grant execute on function public.commission_rate_for(subscription_subject, uuid) to authenticated;

-- ---------------------------------------------------------------
-- 3 · La comisión del local se devenga con cada cobro
--
-- Va sobre el libro de apuntes y no sobre el pedido porque así se corrige sola:
-- un cobro devenga, una devolución desdevenga, y una cuenta a medias devenga lo
-- que se ha cobrado y no lo que se espera cobrar.
-- ---------------------------------------------------------------
create or replace function public.accrue_commission_on_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
  v_cur  char(3);
begin
  v_rate := public.commission_rate_for('restaurant', new.restaurant_id);
  if v_rate <= 0 then return null; end if;

  select currency into v_cur from public.orders where id = new.order_id;

  insert into public.platform_commissions (
    subject_type, subject_id, restaurant_id, order_id, payment_id,
    base_cents, rate, amount_cents, currency
  ) values (
    'restaurant', new.restaurant_id, new.restaurant_id, new.order_id, new.id,
    new.amount_cents, v_rate, round(new.amount_cents * v_rate)::int,
    coalesce(v_cur, 'EUR')
  );

  return null;
end;
$$;

drop trigger if exists order_payments_commission on public.order_payments;
create trigger order_payments_commission
  after insert on public.order_payments
  for each row execute function public.accrue_commission_on_payment();

-- ---------------------------------------------------------------
-- 4 · La comisión del repartidor se devenga al entregar
--
-- Sobre lo que él gana —el envío y la propina—, no sobre la comida: la plataforma
-- no puede llevarse un porcentaje de una cuenta que el repartidor no cobra.
--
-- Una vez por pedido, no por apunte: un pedido se entrega una sola vez, y
-- repartirlo entre cobros parciales no significaría nada.
-- ---------------------------------------------------------------
create or replace function public.accrue_courier_commission(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rate  numeric;
  v_base  int;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.courier_id is null then return; end if;

  -- Idempotente: reintentar una entrega no cobra dos veces.
  if exists (
    select 1 from public.platform_commissions
    where order_id = p_order_id and subject_type = 'courier'
  ) then
    return;
  end if;

  v_rate := public.commission_rate_for('courier', v_order.courier_id);
  if v_rate <= 0 then return; end if;

  v_base := coalesce(v_order.delivery_fee_cents, 0) + coalesce(v_order.tip_cents, 0);
  if v_base <= 0 then return; end if;

  insert into public.platform_commissions (
    subject_type, subject_id, restaurant_id, order_id,
    base_cents, rate, amount_cents, currency
  ) values (
    'courier', v_order.courier_id, v_order.restaurant_id, p_order_id,
    v_base, v_rate, round(v_base * v_rate)::int, v_order.currency
  );
end;
$$;

-- La entrega del repartidor devenga su comisión.
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

  perform public.accrue_courier_commission(p_order_id);

  return jsonb_build_object('ok', true, 'cash_cents', v_cash);
end;
$$;

-- ---------------------------------------------------------------
-- 5 · Estado de cuenta con la plataforma
-- ---------------------------------------------------------------
create or replace function public.platform_account(
  p_subject_type subscription_subject,
  p_subject_id   uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'subject_type', p_subject_type,
    'subject_id', p_subject_id,
    'rate', public.commission_rate_for(p_subject_type, p_subject_id),
    'pending_cents', coalesce((
      select sum(amount_cents) from public.platform_commissions
      where subject_type = p_subject_type and subject_id = p_subject_id
        and settlement_id is null), 0),
    'pending_lines', coalesce((
      select count(*) from public.platform_commissions
      where subject_type = p_subject_type and subject_id = p_subject_id
        and settlement_id is null), 0),
    'settled_cents', coalesce((
      select sum(amount_cents) from public.platform_commissions
      where subject_type = p_subject_type and subject_id = p_subject_id
        and settlement_id is not null), 0),
    'base_cents', coalesce((
      select sum(base_cents) from public.platform_commissions
      where subject_type = p_subject_type and subject_id = p_subject_id
        and settlement_id is null), 0),
    'last_settlement', (
      select jsonb_build_object('at', settled_at, 'amount_cents', amount_cents, 'lines', lines)
      from public.platform_settlements
      where subject_type = p_subject_type and subject_id = p_subject_id
      order by settled_at desc limit 1)
  )
  where public.is_superadmin()
     or (p_subject_type = 'restaurant' and public.is_staff_of(p_subject_id))
     or (p_subject_type = 'courier' and p_subject_id = public.my_courier_id());
$$;

/**
 * Cierra lo devengado de un sujeto.
 *
 * Agrupa todas las líneas pendientes en una liquidación con su importe y su
 * fecha. No borra nada: las líneas quedan marcadas, que es lo que permite
 * reconstruir después de dónde salió cada euro.
 */
create or replace function public.settle_platform_commissions(
  p_subject_type subscription_subject,
  p_subject_id   uuid,
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_total  int;
  v_lines  int;
  v_cur    char(3);
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(sum(amount_cents), 0)::int, count(*)::int, coalesce(min(currency), 'EUR')
    into v_total, v_lines, v_cur
    from public.platform_commissions
   where subject_type = p_subject_type and subject_id = p_subject_id
     and settlement_id is null;

  if v_lines = 0 then
    return jsonb_build_object('ok', true, 'lines', 0, 'amount_cents', 0);
  end if;

  insert into public.platform_settlements (
    subject_type, subject_id, lines, amount_cents, currency, note, settled_by
  ) values (
    p_subject_type, p_subject_id, v_lines, v_total, v_cur,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  ) returning id into v_id;

  update public.platform_commissions
     set settlement_id = v_id
   where subject_type = p_subject_type and subject_id = p_subject_id
     and settlement_id is null;

  return jsonb_build_object('ok', true, 'id', v_id, 'lines', v_lines, 'amount_cents', v_total);
end;
$$;

-- ---------------------------------------------------------------
-- 6 · Los ingresos de la plataforma
--
-- La analítica que había mide lo que venden los locales. Esto mide lo que gana
-- la plataforma, que es la otra mitad y no estaba en ningún sitio.
-- ---------------------------------------------------------------
create or replace function public.platform_revenue(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with desde as (select now() - make_interval(days => greatest(p_days, 1)) as d),
  cuotas as (
    select * from public.payments, desde
    where status = 'paid' and created_at > desde.d
  ),
  comis as (
    select * from public.platform_commissions, desde
    where created_at > desde.d
  )
  select jsonb_build_object(
    'fees_cents', coalesce((select sum(amount_cents) from cuotas), 0),
    'fees_count', (select count(*) from cuotas),
    'commission_cents', coalesce((select sum(amount_cents) from comis), 0),
    'commission_base_cents', coalesce((select sum(base_cents) from comis), 0),
    'commission_restaurants_cents', coalesce((
      select sum(amount_cents) from comis where subject_type = 'restaurant'), 0),
    'commission_couriers_cents', coalesce((
      select sum(amount_cents) from comis where subject_type = 'courier'), 0),

    'pending_cents', coalesce((
      select sum(amount_cents) from public.platform_commissions where settlement_id is null), 0),

    'active_subscriptions', (
      select count(*) from public.subscriptions
      where status in ('trialing','active','past_due') and current_period_end > now()),
    'paying_restaurants', (
      select count(*) from public.subscriptions
      where subject_type = 'restaurant' and status in ('trialing','active','past_due')
        and current_period_end > now()),
    'paying_couriers', (
      select count(*) from public.subscriptions
      where subject_type = 'courier' and status in ('trialing','active','past_due')
        and current_period_end > now()),

    -- Quién aporta más comisión: lo que decide a quién cuidar.
    'top_restaurants', coalesce((
      select jsonb_agg(x order by x->>'cents' desc) from (
        select jsonb_build_object(
          'id', r.id, 'name', r.name,
          'cents', sum(c.amount_cents)::int,
          'base_cents', sum(c.base_cents)::int) as x
        from comis c join public.restaurants r on r.id = c.subject_id
        where c.subject_type = 'restaurant'
        group by r.id, r.name
        order by sum(c.amount_cents) desc
        limit 8
      ) s), '[]'::jsonb),

    'pending_by_subject', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'subject_type', c.subject_type,
          'subject_id', c.subject_id,
          'name', coalesce(r.name, pr.full_name, pr.email, '—'),
          'lines', count(*)::int,
          'cents', sum(c.amount_cents)::int) as x
        from public.platform_commissions c
        left join public.restaurants r
          on c.subject_type = 'restaurant' and r.id = c.subject_id
        left join public.couriers co
          on c.subject_type = 'courier' and co.id = c.subject_id
        left join public.profiles pr on pr.id = co.user_id
        where c.settlement_id is null
        group by c.subject_type, c.subject_id, r.name, pr.full_name, pr.email
        order by sum(c.amount_cents) desc
        limit 20
      ) s), '[]'::jsonb)
  )
  where public.is_superadmin();
$$;

-- ---------------------------------------------------------------
-- 7 · Acceso
--
-- El libro se lee; se escribe sólo por los disparadores y las funciones. Cada
-- uno ve lo suyo: un restaurante su comisión, un repartidor la suya, y el
-- superadministrador todo.
-- ---------------------------------------------------------------
alter table public.platform_commissions enable row level security;
alter table public.platform_commissions force row level security;
alter table public.platform_settlements enable row level security;
alter table public.platform_settlements force row level security;

drop policy if exists platform_commissions_read on public.platform_commissions;
create policy platform_commissions_read on public.platform_commissions
  for select to authenticated
  using (
    public.is_superadmin()
    or (subject_type = 'restaurant' and public.is_staff_of(subject_id))
    or (subject_type = 'courier' and subject_id = public.my_courier_id())
  );

drop policy if exists platform_settlements_read on public.platform_settlements;
create policy platform_settlements_read on public.platform_settlements
  for select to authenticated
  using (
    public.is_superadmin()
    or (subject_type = 'restaurant' and public.is_staff_of(subject_id))
    or (subject_type = 'courier' and subject_id = public.my_courier_id())
  );

grant select on public.platform_commissions, public.platform_settlements to authenticated;
grant execute on function public.platform_account(subscription_subject, uuid) to authenticated;
grant execute on function public.settle_platform_commissions(subscription_subject, uuid, text) to authenticated;
grant execute on function public.platform_revenue(integer) to authenticated;
