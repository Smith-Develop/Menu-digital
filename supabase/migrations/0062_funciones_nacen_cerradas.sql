-- =============================================================
--  Que no haya que acordarse
--
--  Las migraciones 0057 y 0058 cerraron los permisos, y el trinquete de la
--  prueba de superficie encontró que se habían vuelto a abrir en cuanto se
--  crearon funciones nuevas: cuatro de los cimientos de cobro salieron
--  ejecutables sin sesión.
--
--  El motivo es que `alter default privileges ... revoke execute on functions
--  from public` no suprime la concesión que PostgreSQL hace a PUBLIC al crear
--  cada función. Está comprobado a mano: una función recién creada sigue
--  naciendo con `=X`, con la regla puesta.
--
--  Se puede revocar en cada migración, y basta con que alguien se olvide una
--  vez. Un disparador de eventos lo hace solo, para siempre, sin que nadie
--  tenga que acordarse. Las concesiones nominales que vienen después en la
--  misma migración siguen valiendo: éste sólo quita la puerta abierta de par
--  en par, no las que se abren a propósito.
-- =============================================================

create or replace function public.cerrar_funcion_nueva()
returns event_trigger
language plpgsql
security definer
as $$
declare
  objeto record;
begin
  for objeto in select * from pg_event_trigger_ddl_commands() loop
    if objeto.object_type = 'function' and objeto.schema_name = 'public' then
      execute format('revoke execute on function %s from public', objeto.object_identity);
    end if;
  end loop;
end $$;

drop event trigger if exists funciones_nacen_cerradas;
create event trigger funciones_nacen_cerradas
  on ddl_command_end
  when tag in ('CREATE FUNCTION')
  execute function public.cerrar_funcion_nueva();

-- Y se limpia lo que ya había entrado por esa puerta.
revoke execute on all functions in schema public from public;

-- `create_payment_intent` deja pasar cuando no hay sesión, porque el servidor
-- la llama en nombre de un cliente sin cuenta que ya ha demostrado tener el
-- testigo del pedido. Eso sólo es seguro si `anon` no puede llamarla; hasta
-- ahora podía, y era el agujero de verdad detrás del aviso del trinquete.
revoke all on function public.create_payment_intent(uuid, uuid) from public, anon;
grant execute on function public.create_payment_intent(uuid, uuid) to authenticated, service_role;

grant execute on function public.merchant_payment_options(uuid) to anon, authenticated;
grant execute on function public.save_merchant_credentials(uuid, jsonb) to authenticated;
grant execute on function public.jsonb_object_keys_count(jsonb) to authenticated;
