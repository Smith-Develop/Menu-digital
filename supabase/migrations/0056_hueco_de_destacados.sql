-- =============================================================
--  Fase E · cuántos sitios quedan
--
--  Quien va a contratar necesita saber si queda hueco antes de elegir fechas.
--  No puede consultarlo por su cuenta: las contrataciones de los demás no son
--  suyas y las políticas se lo impiden, con razón —saber qué compra la
--  competencia y cuándo no es asunto de nadie—. Esto responde lo único que sí
--  le incumbe: cuántos sitios hay y cuántos están cogidos esos días.
-- =============================================================

create or replace function public.sponsorship_availability(
  p_city_slug text,
  p_kind      sponsorship_kind,
  p_from      date,
  p_to        date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with oferta as (
    select o.* from public.sponsorship_offers o
     where o.is_active and o.kind = p_kind
       and coalesce(o.city_slug, '') in (coalesce(p_city_slug, ''), '')
     order by (o.city_slug is not null) desc
     limit 1
  ),
  cogidos as (
    select count(*)::int as n
    from public.sponsorships s, oferta o
    where s.status <> 'cancelled'
      and s.kind = p_kind
      and coalesce(s.city_slug, '') = coalesce(o.city_slug, '')
      and s.starts_on <= p_to
      and s.ends_on   >= p_from
  )
  select case
    when (select count(*) from oferta) = 0
      then jsonb_build_object('offered', false)
    else jsonb_build_object(
      'offered', true,
      'slots', (select slots from oferta),
      'taken', (select n from cogidos),
      'free', greatest((select slots from oferta) - (select n from cogidos), 0),
      'price_cents', (select price_cents from oferta),
      'currency', (select currency from oferta),
      -- Los dos extremos incluidos: del 3 al 3 es un día.
      'days', (p_to - p_from) + 1,
      'total_cents', (select price_cents from oferta) * ((p_to - p_from) + 1))
  end;
$$;

grant execute on function public.sponsorship_availability(text, sponsorship_kind, date, date) to authenticated;
