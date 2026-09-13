-- =============================================================
--  El entorno lo dice la pasarela, no el prefijo de la llave
--
--  La migración anterior de esta tanda dio por hecho que las credenciales de
--  prueba de Mercado Pago empiezan por `TEST-` y las reales por `APP_USR-`. Era
--  verdad y ha dejado de serlo: las credenciales de prueba que emite hoy su
--  panel empiezan también por `APP_USR-`. Las dos son indistinguibles mirando
--  la llave.
--
--  Una etiqueta que adivina es peor que ninguna. Decirle a un comercio «modo
--  real» cuando tiene llaves de prueba le hace buscar el problema donde no
--  está, que es exactamente la tarde que este trabajo intenta ahorrar.
--
--  Así que se deja de adivinar y se guarda lo que la pasarela contesta. Sus
--  respuestas de cobro traen `live_mode`, que es la única fuente que no se
--  equivoca: dice si ese cobro movió dinero de verdad. Se anota en cuanto se
--  sabe, y hasta entonces la pantalla dice que no lo sabe, que es la verdad.
-- =============================================================

alter table public.merchant_payment_methods
  add column if not exists live_mode boolean,
  add column if not exists live_mode_at timestamptz;

comment on column public.merchant_payment_methods.live_mode is
  'Si estas llaves mueven dinero de verdad. Lo dice la pasarela en su respuesta '
  'de cobro, no el prefijo de la llave. Nulo significa que todavía no se sabe.';

/**
 * Anota el entorno que la pasarela acaba de declarar.
 *
 * Va por función y no por escritura directa porque quien lo sabe es el
 * servidor, con la llave de servicio, y el comercio no debe poder decir que
 * sus llaves son de prueba cuando no lo son.
 */
create or replace function public.record_live_mode(p_method_id uuid, p_live boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.merchant_payment_methods
     set live_mode = p_live, live_mode_at = now(), updated_at = now()
   where id = p_method_id
     and (live_mode is distinct from p_live or live_mode_at is null);
$$;

grant execute on function public.record_live_mode(uuid, boolean) to service_role;
