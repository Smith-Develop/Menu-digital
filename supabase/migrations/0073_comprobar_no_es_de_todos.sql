-- =============================================================
--  La comprobación de dirección no la necesita nadie sin sesión
--
--  La migración 0070 concedió `address_looks_complete` a `anon` por inercia, y
--  el trinquete de la prueba de superficie lo cazó en la misma tanda: 32
--  funciones ejecutables sin sesión donde el techo eran 31.
--
--  Nadie sin sesión la llama. El escaparate comprueba lo mismo mientras se
--  escribe, pero lo hace en el navegador y con su gemela de TypeScript; y
--  dentro de `place_order` la llamada la hace la función, que es
--  `security definer` y corre como su dueño, no como quien pide.
--
--  Es exactamente para esto que el techo sólo puede bajar: la concesión de más
--  no la pidió nadie, y sin la prueba se habría quedado.
-- =============================================================

revoke execute on function public.address_looks_complete(text) from anon;
