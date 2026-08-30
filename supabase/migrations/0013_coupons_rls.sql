-- =============================================================
--  Yumi · RLS de cupones e invitaciones
-- =============================================================
do $$
declare t text;
begin
  foreach t in array array['coupons','coupon_products','coupon_categories',
                           'coupon_redemptions','staff_invitations']
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
             and tablename in ('coupons','coupon_products','coupon_categories',
                               'coupon_redemptions','staff_invitations')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- coupons ----------
-- El catálogo no se expone: un cupón se comprueba escribiendo el código, que es
-- lo que hace validate_coupon (SECURITY DEFINER). Aquí solo lee quien lo gestiona.
create policy coupons_owner_read on public.coupons
  for select to authenticated
  using (
    public.is_superadmin()
    or (restaurant_id is not null and public.is_staff_of(restaurant_id))
  );

create policy coupons_restaurant_write on public.coupons
  for all to authenticated
  using (
    restaurant_id is not null
    and public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[])
  )
  with check (
    restaurant_id is not null
    and public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[])
  );

create policy coupons_superadmin_write on public.coupons
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------- alcance del cupón ----------
create policy coupon_products_manage on public.coupon_products
  for all to authenticated
  using (exists (
    select 1 from public.coupons c where c.id = coupon_id
      and (public.is_superadmin() or (c.restaurant_id is not null and public.is_staff_of(c.restaurant_id)))))
  with check (exists (
    select 1 from public.coupons c where c.id = coupon_id
      and (public.is_superadmin() or (c.restaurant_id is not null and public.is_staff_of(c.restaurant_id)))));

create policy coupon_categories_manage on public.coupon_categories
  for all to authenticated
  using (exists (
    select 1 from public.coupons c where c.id = coupon_id
      and (public.is_superadmin() or (c.restaurant_id is not null and public.is_staff_of(c.restaurant_id)))))
  with check (exists (
    select 1 from public.coupons c where c.id = coupon_id
      and (public.is_superadmin() or (c.restaurant_id is not null and public.is_staff_of(c.restaurant_id)))));

-- ---------- canjes ----------
create policy coupon_redemptions_read on public.coupon_redemptions
  for select to authenticated
  using (
    customer_id = auth.uid()
    or public.is_superadmin()
    or (restaurant_id is not null and public.is_staff_of(restaurant_id))
  );

-- ---------- invitaciones ----------
create policy staff_invitations_manage on public.staff_invitations
  for all to authenticated
  using (
    public.has_staff_role(restaurant_id, array['owner','admin']::staff_role[])
    or public.is_superadmin()
  )
  with check (
    public.has_staff_role(restaurant_id, array['owner','admin']::staff_role[])
    or public.is_superadmin()
  );
