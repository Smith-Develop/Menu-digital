-- =============================================================
--  Menu Digital · Storage
--  Convención de rutas: <restaurant_id>/<archivo>
--  Así la política puede comprobar la pertenencia con el 1er segmento.
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('restaurants', 'restaurants', true,  5242880,
     array['image/jpeg','image/png','image/webp','image/avif','image/svg+xml']),
  ('products',    'products',    true,  5242880,
     array['image/jpeg','image/png','image/webp','image/avif']),
  ('models',      'models',      true, 52428800,
     array['model/gltf-binary','model/gltf+json','model/vnd.usdz+zip','application/octet-stream']),
  ('avatars',     'avatars',     true,  2097152,
     array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='storage' and tablename='objects'
           and policyname like 'menu_%'
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- Lectura pública de los cuatro buckets (la carta se sirve sin login).
create policy menu_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('restaurants','products','models','avatars'));

-- Escritura: sólo staff del restaurante dueño de la carpeta.
create policy menu_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('restaurants','products','models')
    and public.is_staff_of((storage.foldername(name))[1]::uuid)
  );

create policy menu_staff_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('restaurants','products','models')
    and public.is_staff_of((storage.foldername(name))[1]::uuid)
  );

create policy menu_staff_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('restaurants','products','models')
    and public.is_staff_of((storage.foldername(name))[1]::uuid)
  );

-- Avatares: cada usuario gestiona su carpeta <user_id>/
create policy menu_avatar_write on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
