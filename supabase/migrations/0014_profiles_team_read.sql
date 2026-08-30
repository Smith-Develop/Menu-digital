-- =============================================================
--  Yumi · el restaurante puede ver los datos de su propio equipo
--
--  La política original solo dejaba a cada usuario leer su propio perfil, así
--  que la pantalla de Equipo mostraba a los compañeros sin nombre ni correo.
--  Un restaurante necesita ver a quién tiene contratado.
-- =============================================================

-- ¿Comparten restaurante el usuario actual y este perfil?
create or replace function public.shares_restaurant_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.restaurant_staff mine
    join public.restaurant_staff theirs on theirs.restaurant_id = mine.restaurant_id
    where mine.user_id = auth.uid() and mine.is_active
      and theirs.user_id = p_user
  )
  or exists (
    -- El dueño puede no tener fila en restaurant_staff.
    select 1
    from public.restaurants r
    join public.restaurant_staff s on s.restaurant_id = r.id
    where r.owner_id = auth.uid() and s.user_id = p_user
  )
  or exists (
    -- Y también ve a los repartidores que trabajan para él.
    select 1
    from public.restaurant_couriers rc
    join public.couriers c on c.id = rc.courier_id
    where c.user_id = p_user and rc.is_active
      and public.is_staff_of(rc.restaurant_id)
  );
$$;

grant execute on function public.shares_restaurant_with to authenticated;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_superadmin()
    or public.shares_restaurant_with(id)
  );
