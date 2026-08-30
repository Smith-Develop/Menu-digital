-- =============================================================
--  Yumi · catálogo global de categorías
--
--  Las categorías dejan de ser de cada restaurante y pasan a ser un catálogo
--  que mantiene el superadministrador. Solo así los chips de la portada
--  agrupan de verdad: antes "Pizzas" de un local y "Pizza" de otro eran cosas
--  distintas y el filtro no cruzaba restaurantes.
-- =============================================================

create table if not exists public.catalog_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  image_url   text,
  icon        text,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists catalog_categories_active_idx
  on public.catalog_categories (position) where is_active;

drop trigger if exists set_updated_at on public.catalog_categories;
create trigger set_updated_at before update on public.catalog_categories
  for each row execute function public.touch_updated_at();

-- ---------- Migración de lo que ya existe ----------
-- Las categorías que cada restaurante había creado se funden por nombre en el
-- catálogo global, y los platos se reapuntan sin perder su clasificación.
insert into public.catalog_categories (name, slug, image_url, position)
select distinct on (public.slugify(c.name))
       initcap(btrim(c.name)),
       public.slugify(c.name),
       first_value(c.image_url) over (
         partition by public.slugify(c.name)
         order by (c.image_url is null), c.created_at
       ),
       0
from public.categories c
where coalesce(btrim(c.name), '') <> ''
on conflict (slug) do nothing;

alter table public.products
  add column if not exists catalog_category_id uuid references public.catalog_categories(id) on delete set null;

update public.products p
   set catalog_category_id = cc.id
  from public.categories c
  join public.catalog_categories cc on cc.slug = public.slugify(c.name)
 where p.category_id = c.id
   and p.catalog_category_id is null;

create index if not exists products_catalog_category_idx
  on public.products (catalog_category_id);

-- Orden de aparición: primero las categorías con más platos.
with ranked as (
  select cc.id, row_number() over (order by count(p.id) desc, cc.name) as rn
  from public.catalog_categories cc
  left join public.products p on p.catalog_category_id = cc.id
  group by cc.id, cc.name
)
update public.catalog_categories cc
   set position = ranked.rn
  from ranked
 where ranked.id = cc.id;

-- ---------- RLS ----------
alter table public.catalog_categories enable row level security;
alter table public.catalog_categories force row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='catalog_categories'
  loop
    execute format('drop policy if exists %I on public.catalog_categories', r.policyname);
  end loop;
end $$;

create policy catalog_categories_public_read on public.catalog_categories
  for select to anon, authenticated using (is_active or public.is_superadmin());

create policy catalog_categories_superadmin_write on public.catalog_categories
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------
-- Categorías que enseña la portada: solo las que tienen platos
-- servibles en la ciudad del cliente.
-- ---------------------------------------------------------------
create or replace function public.home_categories(p_city_slug text default null, p_limit integer default 12)
returns table (id uuid, name text, slug text, image_url text, products integer)
language sql stable security definer set search_path = public as $$
  select cc.id, cc.name, cc.slug, cc.image_url, count(p.id)::int as products
  from public.catalog_categories cc
  join public.products p on p.catalog_category_id = cc.id and p.is_available
  join public.restaurants r on r.id = p.restaurant_id
  where cc.is_active
    and r.is_active
    and public.restaurant_is_live(r.id)
    and (p_city_slug is null or r.city_slug = p_city_slug)
  group by cc.id, cc.name, cc.slug, cc.image_url, cc.position
  order by cc.position, count(p.id) desc
  limit greatest(coalesce(p_limit, 12), 1);
$$;

grant execute on function public.home_categories to anon, authenticated;
