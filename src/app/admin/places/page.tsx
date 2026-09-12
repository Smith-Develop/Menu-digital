import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { PlacesManager, type PaisAdmin, type PasarelaSimple } from '@/components/admin/places-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Países y ciudades' };

export default async function PlacesPage() {
  await requireSuperadmin();
  const supabase = await createServerSupabase();

  const [{ data: paises }, { data: ciudades }, { data: cobertura }, { data: pasarelas }, { data: locales }] =
    await Promise.all([
      supabase.from('platform_countries').select('*').order('position').order('name'),
      supabase.from('platform_cities').select('country, name').eq('is_active', true)
        .order('position').order('name'),
      supabase.from('country_payment_providers').select('country, provider_id'),
      supabase.from('payment_providers').select('id, name, countries').eq('is_active', true)
        .order('position'),
      supabase.from('restaurants').select('country'),
    ]);

  // Cuántos locales hay en cada país: decide si se puede borrar o sólo apagar.
  const cuantos = new Map<string, number>();
  for (const r of locales ?? []) {
    if (r.country) cuantos.set(r.country, (cuantos.get(r.country) ?? 0) + 1);
  }

  const porPais = new Map<string, string[]>();
  for (const c of ciudades ?? []) {
    porPais.set(c.country, [...(porPais.get(c.country) ?? []), c.name]);
  }

  const gatewaysPorPais = new Map<string, string[]>();
  for (const c of cobertura ?? []) {
    gatewaysPorPais.set(c.country, [...(gatewaysPorPais.get(c.country) ?? []), c.provider_id]);
  }

  const filas: PaisAdmin[] = (paises ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    currency: p.currency,
    timezone: p.timezone,
    isActive: p.is_active,
    position: p.position,
    cities: porPais.get(p.code) ?? [],
    gateways: gatewaysPorPais.get(p.code) ?? [],
    restaurants: cuantos.get(p.code) ?? 0,
  }));

  return (
    <PlacesManager
      paises={filas}
      pasarelas={(pasarelas ?? []) as PasarelaSimple[]}
    />
  );
}
