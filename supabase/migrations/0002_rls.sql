-- =============================================================
--  Menu Digital · Row Level Security
--
--  Modelo de acceso:
--   · anon        → sólo lectura de la carta pública (restaurantes activos)
--   · staff       → lectura/escritura acotada a SUS restaurantes
--   · superadmin  → todo
--   · escrituras de pedidos y llamadas de mesa → sólo service_role
--     (las hace el servidor de Next.js, nunca el navegador del cliente)
-- =============================================================

-- ---------- Helpers (security definer: no disparan RLS y evitan recursión) ----------
create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin'
  );
$$;

create or replace function public.is_staff_of(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_staff s
    where s.restaurant_id = rid and s.user_id = auth.uid() and s.is_active
  ) or exists (
    select 1 from public.restaurants r
    where r.id = rid and r.owner_id = auth.uid()
  );
$$;

create or replace function public.has_staff_role(rid uuid, allowed staff_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.restaurant_staff s
    where s.restaurant_id = rid and s.user_id = auth.uid()
      and s.is_active and s.role = any(allowed)
  ) or exists (
    select 1 from public.restaurants r
    where r.id = rid and r.owner_id = auth.uid()
  );
$$;

-- ¿La suscripción del restaurante permite servir su carta al público?
create or replace function public.restaurant_is_live(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.restaurants r
    left join public.subscriptions s
      on s.restaurant_id = r.id
     and s.status in ('trialing','active','past_due')
    where r.id = rid
      and r.is_active
      and (s.id is null or s.current_period_end > now())
  );
$$;

grant execute on function public.is_superadmin, public.is_staff_of,
  public.has_staff_role, public.restaurant_is_live to anon, authenticated;

-- ---------- Activar RLS en todo ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','plans','restaurants','subscriptions','payments',
                           'restaurant_staff','tables','categories','products',
                           'option_groups','options','orders','order_items','order_events',
                           'waiter_calls','reviews','favorites']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Limpieza idempotente de políticas previas.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname='public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---------- profiles ----------
create policy profiles_self_read on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_superadmin());
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()));
create policy profiles_superadmin_all on public.profiles
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- plans (catálogo público; sólo superadmin escribe) ----------
create policy plans_public_read on public.plans
  for select to anon, authenticated using (is_active or public.is_superadmin());
create policy plans_superadmin_write on public.plans
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- restaurants ----------
create policy restaurants_public_read on public.restaurants
  for select to anon, authenticated using (is_active);
create policy restaurants_staff_read on public.restaurants
  for select to authenticated using (public.is_staff_of(id) or public.is_superadmin());
create policy restaurants_owner_update on public.restaurants
  for update to authenticated
  using (public.has_staff_role(id, array['owner','admin']::staff_role[]) or public.is_superadmin())
  with check (public.has_staff_role(id, array['owner','admin']::staff_role[]) or public.is_superadmin());
create policy restaurants_superadmin_write on public.restaurants
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- subscriptions / payments (lectura del propio restaurante) ----------
create policy subscriptions_staff_read on public.subscriptions
  for select to authenticated using (public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy subscriptions_superadmin_write on public.subscriptions
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

create policy payments_staff_read on public.payments
  for select to authenticated using (public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy payments_superadmin_write on public.payments
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- restaurant_staff ----------
create policy staff_read on public.restaurant_staff
  for select to authenticated using (user_id = auth.uid() or public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy staff_manage on public.restaurant_staff
  for all to authenticated
  using (public.has_staff_role(restaurant_id, array['owner','admin']::staff_role[]) or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin']::staff_role[]) or public.is_superadmin());

-- ---------- tables ----------
create policy tables_public_read on public.tables
  for select to anon, authenticated using (is_active and public.restaurant_is_live(restaurant_id));
create policy tables_staff_all on public.tables
  for all to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin());

-- ---------- categories ----------
create policy categories_public_read on public.categories
  for select to anon, authenticated using (is_active and public.restaurant_is_live(restaurant_id));
create policy categories_staff_all on public.categories
  for all to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin());

-- ---------- products ----------
create policy products_public_read on public.products
  for select to anon, authenticated using (public.restaurant_is_live(restaurant_id));
create policy products_staff_all on public.products
  for all to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin());

-- ---------- option_groups / options ----------
create policy option_groups_public_read on public.option_groups
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.restaurant_is_live(p.restaurant_id)));
create policy option_groups_staff_all on public.option_groups
  for all to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and public.is_staff_of(p.restaurant_id)) or public.is_superadmin())
  with check (exists (select 1 from public.products p where p.id = product_id and public.is_staff_of(p.restaurant_id)) or public.is_superadmin());

create policy options_public_read on public.options
  for select to anon, authenticated
  using (exists (
    select 1 from public.option_groups g join public.products p on p.id = g.product_id
    where g.id = group_id and public.restaurant_is_live(p.restaurant_id)));
create policy options_staff_all on public.options
  for all to authenticated
  using (exists (
    select 1 from public.option_groups g join public.products p on p.id = g.product_id
    where g.id = group_id and public.is_staff_of(p.restaurant_id)) or public.is_superadmin())
  with check (exists (
    select 1 from public.option_groups g join public.products p on p.id = g.product_id
    where g.id = group_id and public.is_staff_of(p.restaurant_id)) or public.is_superadmin());

-- ---------- orders ----------
-- El navegador anónimo NO lee ni escribe pedidos: lo hace el servidor con service_role
-- y expone el seguimiento mediante public_token. Staff y cliente logueado sí leen.
create policy orders_staff_read on public.orders
  for select to authenticated using (public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy orders_customer_read on public.orders
  for select to authenticated using (customer_id = auth.uid());
create policy orders_staff_update on public.orders
  for update to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin())
  with check (public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy orders_staff_insert on public.orders
  for insert to authenticated with check (public.is_staff_of(restaurant_id) or public.is_superadmin());

create policy order_items_read on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (public.is_staff_of(o.restaurant_id) or o.customer_id = auth.uid() or public.is_superadmin())));
create policy order_items_staff_write on public.order_items
  for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (public.is_staff_of(o.restaurant_id) or public.is_superadmin())))
  with check (exists (select 1 from public.orders o where o.id = order_id and (public.is_staff_of(o.restaurant_id) or public.is_superadmin())));

create policy order_events_read on public.order_events
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (public.is_staff_of(o.restaurant_id) or o.customer_id = auth.uid() or public.is_superadmin())));
create policy order_events_staff_write on public.order_events
  for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and (public.is_staff_of(o.restaurant_id) or public.is_superadmin())));

-- ---------- waiter_calls ----------
create policy waiter_calls_staff_read on public.waiter_calls
  for select to authenticated using (public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy waiter_calls_staff_write on public.waiter_calls
  for all to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin())
  with check (public.is_staff_of(restaurant_id) or public.is_superadmin());

-- ---------- reviews ----------
create policy reviews_public_read on public.reviews
  for select to anon, authenticated using (true);
create policy reviews_customer_write on public.reviews
  for insert to authenticated with check (customer_id = auth.uid());
create policy reviews_staff_manage on public.reviews
  for delete to authenticated using (public.is_staff_of(restaurant_id) or public.is_superadmin());

-- ---------- favorites ----------
create policy favorites_owner_all on public.favorites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.waiter_calls;
alter table public.orders       replica identity full;
alter table public.order_items  replica identity full;
alter table public.waiter_calls replica identity full;
