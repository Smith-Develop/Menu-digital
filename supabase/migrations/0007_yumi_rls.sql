-- =============================================================
--  Yumi · RLS de banners, repartidores, marca y notificaciones
-- =============================================================

-- ¿El usuario actual es este repartidor?
create or replace function public.is_courier(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.couriers c
    where c.id = cid and c.user_id = auth.uid()
  );
$$;

-- Id de repartidor del usuario actual (null si no lo es).
create or replace function public.my_courier_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.couriers where user_id = auth.uid() limit 1;
$$;

-- ¿Este repartidor trabaja para este restaurante?
create or replace function public.courier_works_for(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.restaurant_couriers rc
    join public.couriers c on c.id = rc.courier_id
    where rc.restaurant_id = rid and c.user_id = auth.uid()
      and rc.is_active and c.is_active
  );
$$;

grant execute on function public.is_courier, public.my_courier_id,
  public.courier_works_for to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['banners','couriers','restaurant_couriers','app_settings','notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('banners','couriers','restaurant_couriers','app_settings','notifications')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- banners ----------
-- Público: solo los vigentes de restaurantes con la carta viva.
create policy banners_public_read on public.banners
  for select to anon, authenticated
  using (
    is_active
    and public.restaurant_is_live(restaurant_id)
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );
create policy banners_staff_read on public.banners
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());
create policy banners_staff_write on public.banners
  for all to authenticated
  using (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin());

-- ---------- couriers ----------
-- El repartidor gestiona su ficha; el restaurante ve a los suyos para asignarles pedidos.
create policy couriers_self_read on public.couriers
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_superadmin()
    or exists (
      select 1 from public.restaurant_couriers rc
      where rc.courier_id = couriers.id and public.is_staff_of(rc.restaurant_id)
    )
  );
create policy couriers_self_insert on public.couriers
  for insert to authenticated with check (user_id = auth.uid());
create policy couriers_self_update on public.couriers
  for update to authenticated
  using (user_id = auth.uid() or public.is_superadmin())
  with check (user_id = auth.uid() or public.is_superadmin());
create policy couriers_superadmin_delete on public.couriers
  for delete to authenticated using (public.is_superadmin());

-- ---------- restaurant_couriers ----------
create policy restaurant_couriers_read on public.restaurant_couriers
  for select to authenticated
  using (
    public.is_staff_of(restaurant_id)
    or public.is_courier(courier_id)
    or public.is_superadmin()
  );
create policy restaurant_couriers_staff_write on public.restaurant_couriers
  for all to authenticated
  using (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[]) or public.is_superadmin());
-- El repartidor puede darse de baja de un restaurante, pero no de alta solo.
create policy restaurant_couriers_courier_leave on public.restaurant_couriers
  for delete to authenticated using (public.is_courier(courier_id));

-- ---------- orders: acceso del repartidor ----------
drop policy if exists orders_courier_read on public.orders;
create policy orders_courier_read on public.orders
  for select to authenticated
  using (
    courier_id = public.my_courier_id()
    or (
      -- Pedidos a domicilio sin asignar de los restaurantes para los que trabaja.
      type = 'delivery'
      and courier_id is null
      and status in ('ready','delivering')
      and public.courier_works_for(restaurant_id)
    )
  );

drop policy if exists orders_courier_update on public.orders;
create policy orders_courier_update on public.orders
  for update to authenticated
  using (
    courier_id = public.my_courier_id()
    or (type = 'delivery' and courier_id is null and status = 'ready'
        and public.courier_works_for(restaurant_id))
  )
  with check (
    courier_id = public.my_courier_id()
    or (type = 'delivery' and courier_id is null and status = 'ready'
        and public.courier_works_for(restaurant_id))
  );

drop policy if exists order_items_courier_read on public.order_items;
create policy order_items_courier_read on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and o.courier_id = public.my_courier_id()
  ));

-- ---------- app_settings ----------
-- La marca la lee todo el mundo (pinta la interfaz); solo el superadmin escribe.
create policy app_settings_public_read on public.app_settings
  for select to anon, authenticated using (true);
create policy app_settings_superadmin_write on public.app_settings
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- notifications ----------
create policy notifications_public_read on public.notifications
  for select to anon, authenticated
  using (
    is_active
    and starts_at <= now()
    and (ends_at is null or ends_at >= now())
  );
create policy notifications_superadmin_write on public.notifications
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- Realtime ----------
alter table public.couriers replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.couriers;
exception when duplicate_object then null; end $$;
