-- =============================================================
--  Yumi · retirada de las categorías por restaurante
--
--  Ya migradas al catálogo global en 0015. La tabla se conserva vacía y sin
--  uso durante una versión por si hubiera que revisar algo, pero los productos
--  dejan de apuntar a ella para que no queden dos clasificaciones en paralelo.
-- =============================================================

alter table public.products drop column if exists category_id;

comment on table public.categories is
  'OBSOLETA: sustituida por catalog_categories. Se conserva sin uso; eliminar en una versión futura.';
