-- =============================================================
--  Yumi · el superadministrador sube a las carpetas de plataforma
--
--  Antes solo podía escribir en "app/". El catálogo de categorías y las
--  imágenes de las notificaciones necesitan sus propias carpetas, así que se
--  autoriza cualquier ruta que no sea la de un restaurante.
-- =============================================================

drop policy if exists menu_staff_insert on storage.objects;
create policy menu_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('restaurants','products','models')
    and (
      public.is_staff_of(public.try_uuid((storage.foldername(name))[1]))
      or (public.try_uuid((storage.foldername(name))[1]) is null and public.is_superadmin())
    )
  );

drop policy if exists menu_staff_update on storage.objects;
create policy menu_staff_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('restaurants','products','models')
    and (
      public.is_staff_of(public.try_uuid((storage.foldername(name))[1]))
      or (public.try_uuid((storage.foldername(name))[1]) is null and public.is_superadmin())
    )
  );

drop policy if exists menu_staff_delete on storage.objects;
create policy menu_staff_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('restaurants','products','models')
    and (
      public.is_staff_of(public.try_uuid((storage.foldername(name))[1]))
      or (public.try_uuid((storage.foldername(name))[1]) is null and public.is_superadmin())
    )
  );
