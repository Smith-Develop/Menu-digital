-- =============================================================
--  Lo que se ejecuta solo también necesita permiso
--
--  Cerrar los permisos rompió el guardado de los ajustes del restaurante, y el
--  error no decía nada útil: «permission denied for function slugify».
--
--  `restaurants.city_slug` es una columna generada a partir de la ciudad, y la
--  expresión de una columna generada la evalúa **quien escribe la fila**, no el
--  dueño de la tabla. Al quedarse `slugify` sin permiso para `authenticated`,
--  cualquier cambio en la ficha del local fallaba: el nombre, el horario, la
--  divisa, todo.
--
--  Es la clase de fallo contra la que avisaba la auditoría: revocar privilegios
--  rompe cosas en sitios que no salen en ninguna consulta. Aquí se arregla el
--  caso y se añade la comprobación que impide que vuelva, buscando todas las
--  funciones que se invocan solas —columnas generadas, valores por defecto y
--  restricciones— en vez de sólo ésta.
-- =============================================================

grant execute on function public.slugify(text) to authenticated;

-- El escaparate no escribe en ninguna tabla con columnas generadas, así que
-- `anon` no la necesita. Se concede lo que hace falta y ni una línea más.
