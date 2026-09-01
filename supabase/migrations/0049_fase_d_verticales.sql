-- =============================================================
--  Fase D · que lo usen supermercados
--
--  El noventa por ciento de lo que hace falta ya está: catálogo, carrito,
--  cobro, reparto, caja, existencias y documento fiscal funcionan igual para
--  quien vende comida hecha y para quien vende comida por hacer.
--
--  Lo que faltaba era poder apagar lo que no sirve. No existía ningún campo que
--  dijera qué clase de negocio es cada uno: el restaurante llevaba etiquetas de
--  cocina y tiempo de preparación, el panel tenía pantalla de cocina y mesas, y
--  un supermercado lo habría visto todo.
--
--  Esta migración añade el tipo de negocio y los módulos que enciende cada uno,
--  y le enseña al producto a venderse por peso y por código de barras.
-- =============================================================

do $$ begin
  create type business_type as enum ('restaurant', 'grocery');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_unit as enum ('unit', 'kg', 'g', 'l', 'ml');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 1 · El negocio dice qué es
-- ---------------------------------------------------------------
alter table public.restaurants
  add column if not exists business_type business_type not null default 'restaurant';

comment on column public.restaurants.business_type is
  'Qué clase de negocio es. Gobierna qué módulos del panel se encienden.';

/**
 * Qué módulos tiene encendidos un tipo de negocio.
 *
 * Es una tabla y no una condición dentro del código para que dar de alta un
 * vertical nuevo no obligue a tocar nada: la misma idea que la tabla de
 * secciones por rol, que ya gobierna los permisos del panel.
 */
create table if not exists public.business_modules (
  business_type business_type not null,
  module        text not null,
  enabled       boolean not null default true,
  primary key (business_type, module)
);

insert into public.business_modules (business_type, module, enabled) values
  -- Lo que comparten: vender, cobrar, cuadrar y repartir.
  ('restaurant', 'orders',    true),  ('grocery', 'orders',    true),
  ('restaurant', 'pos',       true),  ('grocery', 'pos',       true),
  ('restaurant', 'cash',      true),  ('grocery', 'cash',      true),
  ('restaurant', 'menu',      true),  ('grocery', 'menu',      true),
  ('restaurant', 'coupons',   true),  ('grocery', 'coupons',   true),
  ('restaurant', 'banners',   true),  ('grocery', 'banners',   true),
  ('restaurant', 'couriers',  true),  ('grocery', 'couriers',  true),
  ('restaurant', 'staff',     true),  ('grocery', 'staff',     true),
  ('restaurant', 'settings',  true),  ('grocery', 'settings',  true),

  -- Lo que sólo tiene sentido con cocina y sala.
  ('restaurant', 'kitchen',   true),  ('grocery', 'kitchen',   false),
  ('restaurant', 'tables',    true),  ('grocery', 'tables',    false),
  ('restaurant', 'floor',     true),  ('grocery', 'floor',     false),

  -- Lo que sólo tiene sentido con miles de referencias.
  ('restaurant', 'picking',   false), ('grocery', 'picking',   true),
  ('restaurant', 'slots',     false), ('grocery', 'slots',     true),
  ('restaurant', 'barcodes',  false), ('grocery', 'barcodes',  true)
on conflict (business_type, module) do update set enabled = excluded.enabled;

alter table public.business_modules enable row level security;
alter table public.business_modules force row level security;
drop policy if exists business_modules_read on public.business_modules;
create policy business_modules_read on public.business_modules
  for select to authenticated using (true);
grant select on public.business_modules to authenticated;

/** ¿Tiene este local encendido este módulo? */
create or replace function public.has_module(p_restaurant_id uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select m.enabled
    from public.restaurants r
    join public.business_modules m on m.business_type = r.business_type
    where r.id = p_restaurant_id and m.module = p_module
  ), true);   -- un módulo que nadie ha declarado no se apaga por sorpresa
$$;

grant execute on function public.has_module(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- 2 · El producto aprende a venderse de otra forma
--
-- Para una carta da igual: una pizza es una pizza. Un supermercado necesita
-- distinguir "leche, 1 L, marca X" de "tomate a 2,40 € el kilo", y necesita el
-- código de barras para dar de alta miles de referencias sin teclearlas.
-- ---------------------------------------------------------------
alter table public.products
  add column if not exists unit          sale_unit not null default 'unit',
  add column if not exists brand         text,
  -- El formato tal y como se lee en el envase: "1 L", "500 g", "pack de 6".
  add column if not exists pack_size     text,
  add column if not exists barcode       text,
  -- Contenido en la unidad de medida, para el precio por kilo o por litro.
  add column if not exists net_content   numeric(10,3),
  -- Se vende a peso: el importe no es exacto hasta pesarlo.
  add column if not exists sold_by_weight boolean not null default false;

-- El código de barras identifica al producto dentro de su local, no en el mundo:
-- dos supermercados pueden vender la misma referencia.
create unique index if not exists products_barcode_idx
  on public.products (restaurant_id, barcode)
  where barcode is not null;

create index if not exists products_brand_idx
  on public.products (restaurant_id, brand) where brand is not null;

/**
 * Precio por unidad de medida.
 *
 * Es lo que la ley suele exigir enseñar junto al precio de venta, y lo que
 * permite comparar dos formatos del mismo producto.
 */
create or replace function public.unit_price_cents(p_product_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.net_content is null or p.net_content <= 0 then null
    -- Los gramos y mililitros se llevan al kilo y al litro, que es como se
    -- compara en una estantería.
    when p.unit in ('g', 'ml') then round(p.price_cents / (p.net_content / 1000.0))::int
    else round(p.price_cents / p.net_content)::int
  end
  from public.products p where p.id = p_product_id;
$$;

grant execute on function public.unit_price_cents(uuid) to anon, authenticated;

-- ---------------------------------------------------------------
-- 3 · El catálogo se hace árbol
--
-- Una carta se apaña con doce categorías. Un supermercado necesita
-- pasillo → familia → subfamilia, con varios miles de referencias colgando.
-- ---------------------------------------------------------------
alter table public.catalog_categories
  add column if not exists parent_id uuid references public.catalog_categories(id) on delete set null,
  -- Para qué tipo de negocio se ofrece. Nulo vale para todos.
  add column if not exists business_type business_type;

create index if not exists catalog_categories_parent_idx
  on public.catalog_categories (parent_id, position);

/**
 * El árbol de categorías, con sus hijos anidados.
 *
 * Dos niveles bastan para una compra: pasillo y familia. Un tercero convierte
 * la navegación en un laberinto y nadie llega al producto.
 */
create or replace function public.catalog_tree(p_business_type business_type default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', padre.id,
    'name', padre.name,
    'slug', padre.slug,
    'icon', padre.icon,
    'image_url', padre.image_url,
    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', hijo.id, 'name', hijo.name, 'slug', hijo.slug, 'icon', hijo.icon)
        order by hijo.position, hijo.name)
      from public.catalog_categories hijo
      where hijo.parent_id = padre.id and hijo.is_active), '[]'::jsonb)
  ) order by padre.position, padre.name), '[]'::jsonb)
  from public.catalog_categories padre
  where padre.is_active
    and padre.parent_id is null
    and (p_business_type is null
         or padre.business_type is null
         or padre.business_type = p_business_type);
$$;

grant execute on function public.catalog_tree(business_type) to anon, authenticated;

-- ---------------------------------------------------------------
-- 4 · Lo que no aplica se apaga de verdad
--
-- No basta con esconder el botón. Un supermercado no tiene mesas, así que el
-- interruptor de "servicio en mesa" no puede quedarse encendido por descuido:
-- se apaga en la propia fila, y entonces `place_order` —que ya lo mira— rechaza
-- el pedido en mesa sin que haya que tocarlo.
--
-- La regla vive aquí y no en el formulario porque el formulario no es el único
-- camino: quedan la API, el panel del superadmin y cualquier importación.
-- ---------------------------------------------------------------
create or replace function public.sync_business_modules()
returns trigger
language plpgsql
as $$
begin
  if new.business_type = 'grocery' then
    new.dinein_enabled := false;
  end if;
  return new;
end $$;

drop trigger if exists restaurants_sync_modules on public.restaurants;
create trigger restaurants_sync_modules
  before insert or update of business_type, dinein_enabled on public.restaurants
  for each row execute function public.sync_business_modules();
