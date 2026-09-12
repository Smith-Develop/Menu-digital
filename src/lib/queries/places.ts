import { createPublicSupabase } from '@/lib/supabase/server';

/**
 * Los países y ciudades que la plataforma ofrece.
 *
 * Estaban escritos en el código y ahora los pone el superadministrador, así que
 * se leen de la base. Se consulta sin sesión a propósito: el alta de un local
 * ocurre antes de tener una, y no hay nada reservado en la lista de países.
 */
export type PaisDisponible = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  cities: string[];
};

export async function listPlaces(): Promise<PaisDisponible[]> {
  const supabase = createPublicSupabase();

  const [{ data: paises }, { data: ciudades }] = await Promise.all([
    supabase
      .from('platform_countries')
      .select('code, name, currency, timezone')
      .eq('is_active', true)
      .order('position')
      .order('name'),
    supabase
      .from('platform_cities')
      .select('country, name')
      .eq('is_active', true)
      .order('position')
      .order('name'),
  ]);

  const porPais = new Map<string, string[]>();
  for (const c of ciudades ?? []) {
    porPais.set(c.country, [...(porPais.get(c.country) ?? []), c.name]);
  }

  return (paises ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    currency: p.currency,
    timezone: p.timezone,
    cities: porPais.get(p.code) ?? [],
  }));
}
