-- =============================================================
--  Bloque 0.3 · quitarle la ejecución a PUBLIC
--
--  La migración anterior revocó los permisos de `anon` y `authenticated` y no
--  sirvió de nada: la prueba de superficie siguió contando 125 funciones
--  ejecutables sin sesión. El motivo estaba un nivel más abajo.
--
--  PostgreSQL concede `EXECUTE` a PUBLIC en cada función que se crea. No es una
--  decisión de esta instalación ni de Supabase: es el reparto por defecto del
--  motor. Quitárselo a un rol concreto deja intacta la concesión general, y por
--  eso el número no se movía.
--
--  Se comprobó antes de tocar nada que ninguna función del esquema `public`
--  pertenece a una extensión. Si alguna lo hiciera, quedarse sin ejecución
--  rompería llamadas internas que nadie ve.
-- =============================================================

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public;

revoke execute on all functions in schema public from public;

-- Las concesiones nominales de la migración anterior siguen en pie y ahora sí
-- son las únicas que dejan pasar.
