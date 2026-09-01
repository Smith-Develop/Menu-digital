-- =============================================================
--  Fase E · el destacado se ve, y se cuenta
--
--  De nada sirve venderlo si no cambia la portada y si no aparece en lo que
--  ingresa la plataforma. Aquí se enchufan las dos cosas: el carrusel pone
--  delante lo contratado, y la pantalla de ingresos deja de contar sólo cuotas
--  y comisiones.
-- =============================================================

/**
 * Banners de la portada, con el destacado contratado delante.
 *
 * El orden ya tenía un primer criterio —lo fijado a mano por la plataforma— y
 * ahora tiene otro por encima: lo que alguien ha pagado por estar ahí. Detrás
 * sigue el azar, que es lo que reparte la portada entre los demás.
 */
-- La firma cambia —ahora dice si la fila va pagada— y una función con otras
-- columnas de salida no se puede sustituir: hay que retirarla primero.
drop function if exists public.home_banners(text, integer);

create function public.home_banners(p_city_slug text, p_limit integer default 6)
returns table (
  id uuid, title text, subtitle text, image_url text, link_url text,
  restaurant_id uuid, restaurant_name text, restaurant_slug text, sponsored boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with patrocinados as (
    select p.restaurant_id from public.sponsored_restaurants(p_city_slug, 'banner') p
  ),
  vigentes as (
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
    select b.*, r.name as r_name, r.slug as r_slug,
           exists (select 1 from patrocinados p where p.restaurant_id = b.restaurant_id) as pagado
    from de_restaurantes b
    join public.restaurants r on r.id = b.restaurant_id
    where r.is_active and r.is_open and public.restaurant_is_live(r.id)
      and (p_city_slug is null or r.city_slug = p_city_slug)

    union all

    select b.*, null::text, null::text, false
    from de_plataforma b
    where cardinality(b.pinned_cities) = 0
       or p_city_slug is null
       or p_city_slug = any (b.pinned_cities)
  )
  select c.id, c.title, c.subtitle, c.image_url, c.link_url,
         c.restaurant_id, c.r_name, c.r_slug, c.pagado
  from candidatos c
  order by
    -- Lo contratado abre la portada. Es lo que se ha vendido.
    c.pagado desc,
    -- Después, lo que la plataforma fijó para esta ciudad.
    (c.is_pinned and (cardinality(c.pinned_cities) = 0
                      or p_city_slug is null
                      or p_city_slug = any (c.pinned_cities))) desc,
    random()
  limit greatest(coalesce(p_limit, 6), 1);
$$;

grant execute on function public.home_banners(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------
-- Los destacados, en las cuentas de la plataforma
-- ---------------------------------------------------------------
create or replace function public.platform_revenue(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with desde as (select now() - make_interval(days => greatest(p_days, 1)) as d),
  cuotas as (
    select * from public.payments, desde
    where status = 'paid' and created_at > desde.d
  ),
  comis as (
    select * from public.platform_commissions, desde
    where created_at > desde.d
  ),
  -- Lo contratado se cuenta cuando se cobra, no cuando se reserva: una reserva
  -- sin pagar no es un ingreso, es una intención.
  destacados as (
    select s.* from public.sponsorships s, desde
    where s.status = 'active' and s.paid_at > desde.d
  )
  select jsonb_build_object(
    'fees_cents', coalesce((select sum(amount_cents) from cuotas), 0),
    'fees_count', (select count(*) from cuotas),
    'commission_cents', coalesce((select sum(amount_cents) from comis), 0),
    'commission_base_cents', coalesce((select sum(base_cents) from comis), 0),
    'commission_restaurants_cents', coalesce((
      select sum(amount_cents) from comis where subject_type = 'restaurant'), 0),
    'commission_couriers_cents', coalesce((
      select sum(amount_cents) from comis where subject_type = 'courier'), 0),

    'sponsorship_cents', coalesce((select sum(total_cents) from destacados), 0),
    'sponsorship_count', (select count(*) from destacados),

    'pending_cents', coalesce((
      select sum(amount_cents) from public.platform_commissions where settlement_id is null), 0),

    'active_subscriptions', (
      select count(*) from public.subscriptions
      where status in ('trialing','active','past_due') and current_period_end > now()),
    'paying_restaurants', (
      select count(*) from public.subscriptions
      where subject_type = 'restaurant' and status in ('trialing','active','past_due')
        and current_period_end > now()),
    'paying_couriers', (
      select count(*) from public.subscriptions
      where subject_type = 'courier' and status in ('trialing','active','past_due')
        and current_period_end > now()),

    -- Reservas esperando cobro: lo que hay que atender hoy para que se encienda.
    'sponsorships_reserved', coalesce((
      select jsonb_agg(x order by x->>'starts_on') from (
        select jsonb_build_object(
          'id', s.id, 'name', r.name, 'kind', s.kind::text, 'city', s.city_slug,
          'starts_on', s.starts_on, 'ends_on', s.ends_on,
          'days', s.days, 'cents', s.total_cents) as x
        from public.sponsorships s
        join public.restaurants r on r.id = s.restaurant_id
        where s.status = 'reserved' and s.ends_on >= current_date
        order by s.starts_on
        limit 20
      ) t), '[]'::jsonb),

    -- Quién aporta más comisión: lo que decide a quién cuidar.
    'top_restaurants', coalesce((
      select jsonb_agg(x order by x->>'cents' desc) from (
        select jsonb_build_object(
          'id', r.id, 'name', r.name,
          'cents', sum(c.amount_cents)::int,
          'base_cents', sum(c.base_cents)::int) as x
        from comis c join public.restaurants r on r.id = c.subject_id
        where c.subject_type = 'restaurant'
        group by r.id, r.name
        order by sum(c.amount_cents) desc
        limit 8
      ) s), '[]'::jsonb),

    'pending_by_subject', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'subject_type', c.subject_type,
          'subject_id', c.subject_id,
          'name', coalesce(r.name, pr.full_name, pr.email, '—'),
          'lines', count(*)::int,
          'cents', sum(c.amount_cents)::int) as x
        from public.platform_commissions c
        left join public.restaurants r
          on c.subject_type = 'restaurant' and r.id = c.subject_id
        left join public.couriers co
          on c.subject_type = 'courier' and co.id = c.subject_id
        left join public.profiles pr on pr.id = co.user_id
        where c.settlement_id is null
        group by c.subject_type, c.subject_id, r.name, pr.full_name, pr.email
        order by sum(c.amount_cents) desc
        limit 20
      ) s), '[]'::jsonb)
  )
  where public.is_superadmin();
$$;

grant execute on function public.platform_revenue(integer) to authenticated;
