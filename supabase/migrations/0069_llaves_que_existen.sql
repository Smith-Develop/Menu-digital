-- =============================================================
--  Tener llaves es que las llaves existan
--
--  La ficha del método guardaba el identificador de su secreto, y en toda la
--  aplicación «tiene llaves» se leía como «ese identificador no es nulo». Eso
--  deja de ser verdad en cuanto el secreto desaparece: el panel sigue diciendo
--  que está configurado, el escaparate sigue ofreciendo el botón de pagar, y
--  quien prueba la conexión recibe un «SIN_CREDENCIALES» que no cuadra con lo
--  que la pantalla le está enseñando.
--
--  Pasó de verdad: la limpieza de la suite de pruebas borraba los secretos por
--  prefijo y se llevó por delante los de un local real. Aquello ya está
--  corregido, pero la lección es la otra: preguntar por el identificador no es
--  preguntar por la llave.
-- =============================================================

/** ¿Tiene este método unas credenciales que de verdad se pueden leer? */
create or replace function public.merchant_has_credentials(p_method_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.merchant_payment_methods m
      join vault.decrypted_secrets v on v.id = m.secret_id
     where m.id = p_method_id
       and coalesce(btrim(v.decrypted_secret), '') not in ('', '{}')
  );
$$;

/** Los métodos de un local cuyas llaves existen. Una llamada en vez de una por fila. */
create or replace function public.merchant_methods_ready(p_restaurant_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m.id), '{}')
    from public.merchant_payment_methods m
    join vault.decrypted_secrets v on v.id = m.secret_id
   where m.restaurant_id = p_restaurant_id
     and coalesce(btrim(v.decrypted_secret), '') not in ('', '{}')
     and (public.is_staff_of(p_restaurant_id) or public.is_superadmin());
$$;

-- El escaparate deja de ofrecer botones que no llevan a ninguna parte.
create or replace function public.merchant_payment_options(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'method_id', m.id,
    'slug', p.slug,
    'name', coalesce(nullif(m.display_name, ''), p.name),
    'logo_url', p.logo_url,
    'kind', p.kind
  ) order by m.position, p.name), '[]'::jsonb)
  from public.merchant_payment_methods m
  join public.payment_providers p on p.id = m.provider_id
  join vault.decrypted_secrets v on v.id = m.secret_id
  where m.restaurant_id = p_restaurant_id
    and m.is_active
    and p.is_active
    and p.kind = 'online'
    -- Encendido sin llaves que se puedan leer no es una forma de pago: es un
    -- botón que falla delante de un cliente.
    and coalesce(btrim(v.decrypted_secret), '') not in ('', '{}');
$$;

-- ---------------------------------------------------------------
-- Reparación: las fichas que apuntan a un secreto que ya no está
-- ---------------------------------------------------------------
update public.merchant_payment_methods m
   set secret_id = null,
       is_active = false,
       updated_at = now()
 where m.secret_id is not null
   and not exists (select 1 from vault.decrypted_secrets v where v.id = m.secret_id);

revoke all on function public.merchant_has_credentials(uuid) from public, anon;
revoke all on function public.merchant_methods_ready(uuid) from public, anon;
grant execute on function public.merchant_has_credentials(uuid) to authenticated, service_role;
grant execute on function public.merchant_methods_ready(uuid) to authenticated, service_role;
grant execute on function public.merchant_payment_options(uuid) to anon, authenticated;
