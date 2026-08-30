import 'server-only';
import { cookies } from 'next/headers';
import { createPublicSupabase } from '@/lib/supabase/server';

export const LOCATION_COOKIE = 'yumi_loc';

export type CustomerLocation = {
  city: string;
  citySlug: string;
  address: string | null;
};

export type CityOption = {
  city: string;
  city_slug: string;
  restaurants: number;
};

/**
 * Ciudad y dirección elegidas por el cliente.
 *
 * Van en una cookie propia (no en la sesión) porque la mayoría de clientes
 * pide sin cuenta, y la portada necesita el dato en el primer render para no
 * enseñar restaurantes de otra ciudad y tener que ocultarlos después.
 */
export async function getCustomerLocation(): Promise<CustomerLocation | null> {
  const store = await cookies();
  const raw = store.get(LOCATION_COOKIE)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<CustomerLocation>;
    if (!parsed.city || !parsed.citySlug) return null;
    return {
      city: String(parsed.city),
      citySlug: String(parsed.citySlug),
      address: parsed.address ? String(parsed.address) : null,
    };
  } catch {
    return null;
  }
}

/** Ciudades que hoy tienen restaurantes sirviendo. */
export async function listCities(): Promise<CityOption[]> {
  const supabase = createPublicSupabase();
  const { data } = await supabase.rpc('list_cities');
  return (data as CityOption[] | null) ?? [];
}

/**
 * Ciudad efectiva de la petición: la elegida por el cliente, y si no la
 * primera de la lista, para que la portada nunca salga vacía.
 */
export async function resolveCity(): Promise<{
  location: CustomerLocation | null;
  citySlug: string | null;
  cities: CityOption[];
}> {
  const [location, cities] = await Promise.all([getCustomerLocation(), listCities()]);

  if (location) {
    // Si la ciudad guardada ya no tiene restaurantes, no filtramos por ella.
    const stillServed = cities.some((c) => c.city_slug === location.citySlug);
    return { location, citySlug: stillServed ? location.citySlug : null, cities };
  }

  return { location: null, citySlug: cities[0]?.city_slug ?? null, cities };
}
