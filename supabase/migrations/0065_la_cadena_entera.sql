-- =============================================================
--  La cadena entera, no sólo el primer eslabón
--
--  La migración anterior concedió `slugify` y el guardado siguió fallando, con
--  otro nombre: `unaccent_fallback`. `slugify` la llama por dentro, y como
--  ninguna de las dos es `security definer`, quien escribe la fila necesita
--  permiso sobre las dos.
--
--  Las dos son funciones puras de texto —quitan tildes y dejan un identificador
--  legible— y no tocan ningún dato, así que concederlas no abre nada.
--
--  La lección, que va en la prueba y no en un comentario: buscar las funciones
--  que aparecen en una columna generada no basta, porque cada una puede llamar
--  a otras. Lo que sí basta es intentar guardar la ficha de un local y ver si
--  se puede, que es lo que hará la suite a partir de ahora.
-- =============================================================

grant execute on function public.unaccent_fallback(text) to authenticated;
