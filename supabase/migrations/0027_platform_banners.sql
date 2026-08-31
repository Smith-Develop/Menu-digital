-- Banners propios de la plataforma en la portada.
--
-- Hasta ahora todos los banners pertenecían a un restaurante y la portada los
-- barajaba al azar. El superadministrador necesita poder poner los suyos y
-- decidir cuál abre la portada, y en qué ciudades.
--
-- `restaurant_id` pasa a admitir nulos: un banner sin restaurante es de la
-- plataforma. `pinned_cities` guarda dónde va primero: vacío significa "en
-- todas", y `is_pinned` distingue el que abre de los que sólo acompañan.
alter table public.banners
  alter column restaurant_id drop not null,
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_cities text[] not null default '{}';

-- Rotación del carrusel de la portada, en segundos.
alter table public.app_settings
  add column if not exists banner_rotation_seconds smallint not null default 6;

/**
 * Banners de la portada.
 *
 * Devuelve primero el que el superadministrador haya fijado para esa ciudad
 * —o para todas—, y detrás el resto barajado. Los de la plataforma no dependen
 * de ningún restaurante, así que se unen por fuera y siguen apareciendo aunque
 * ese día no haya locales abiertos.
 */
-- Se recrea entera: cambia el cuerpo y Postgres no deja alterar los valores por
-- defecto de una función existente.
drop function if exists public.home_banners(text, int);

create function public.home_banners(p_city_slug text, p_limit int default 6)
returns table (
  id uuid,
  title text,
  subtitle text,
  image_url text,
  link_url text,
  restaurant_id uuid,
  restaurant_name text,
  restaurant_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  with vigentes as (
    select b.*
    from public.banners b
    where b.is_active
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at >= now())
  ),
  -- Uno por restaurante, para que un local con muchos no cope la portada.
  de_restaurantes as (
    select distinct on (b.restaurant_id) b.*
    from vigentes b
    where b.restaurant_id is not null
    order by b.restaurant_id, b.position, b.created_at desc
  ),
  de_plataforma as (
    select b.* from vigentes b where b.restaurant_id is null
  ),
  candidatos as (
    select b.*, r.name as r_name, r.slug as r_slug
    from de_restaurantes b
    join public.restaurants r on r.id = b.restaurant_id
    where r.is_active and r.is_open and public.restaurant_is_live(r.id)
      and (p_city_slug is null or r.city_slug = p_city_slug)

    union all

    select b.*, null::text, null::text
    from de_plataforma b
    where cardinality(b.pinned_cities) = 0
       or p_city_slug is null
       or p_city_slug = any (b.pinned_cities)
  )
  select c.id, c.title, c.subtitle, c.image_url, c.link_url,
         c.restaurant_id, c.r_name, c.r_slug
  from candidatos c
  order by
    -- El fijado para esta ciudad abre; después, orden aleatorio.
    (c.is_pinned and (cardinality(c.pinned_cities) = 0
                      or p_city_slug is null
                      or p_city_slug = any (c.pinned_cities))) desc,
    random()
  limit greatest(coalesce(p_limit, 6), 1);
$$;

grant execute on function public.home_banners(text, int) to anon, authenticated;

-- El superadministrador gestiona los banners sin restaurante.
drop policy if exists banners_platform_admin on public.banners;
create policy banners_platform_admin on public.banners
  for all to authenticated
  using (restaurant_id is null and public.is_superadmin())
  with check (restaurant_id is null and public.is_superadmin());
