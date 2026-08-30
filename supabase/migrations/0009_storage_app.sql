-- =============================================================
--  Yumi · el superadministrador sube el logotipo de la aplicación
--
--  La política existente exige que el primer segmento de la ruta sea el uuid
--  del restaurante. Los recursos de marca viven en la carpeta "app/", que no
--  es un uuid: con el cast directo la comprobación reventaba en vez de denegar.
-- =============================================================

-- Cast tolerante: devuelve null en vez de fallar si el texto no es un uuid.
create or replace function public.try_uuid(txt text)
returns uuid language plpgsql immutable as $$
begin
  return txt::uuid;
exception when others then
  return null;
end $$;

grant execute on function public.try_uuid to anon, authenticated;

drop policy if exists menu_staff_insert on storage.objects;
create policy menu_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('restaurants','products','models')
    and (
      public.is_staff_of(public.try_uuid((storage.foldername(name))[1]))
      or ((storage.foldername(name))[1] = 'app' and public.is_superadmin())
    )
  );

drop policy if exists menu_staff_update on storage.objects;
create policy menu_staff_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('restaurants','products','models')
    and (
      public.is_staff_of(public.try_uuid((storage.foldername(name))[1]))
      or ((storage.foldername(name))[1] = 'app' and public.is_superadmin())
    )
  );

drop policy if exists menu_staff_delete on storage.objects;
create policy menu_staff_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('restaurants','products','models')
    and (
      public.is_staff_of(public.try_uuid((storage.foldername(name))[1]))
      or ((storage.foldername(name))[1] = 'app' and public.is_superadmin())
    )
  );
