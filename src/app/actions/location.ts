'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createPublicSupabase } from '@/lib/supabase/server';
import { LOCATION_COOKIE } from '@/lib/customer-location';

/** Guarda la ciudad y la dirección del cliente en su cookie. */
export async function setCustomerLocation(input: {
  city: string;
  citySlug: string;
  address?: string | null;
}) {
  const store = await cookies();
  store.set(
    LOCATION_COOKIE,
    encodeURIComponent(
      JSON.stringify({
        city: input.city,
        citySlug: input.citySlug,
        address: input.address?.trim() || null,
      }),
    ),
    {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    },
  );

  revalidatePath('/');
  return { ok: true as const };
}

/**
 * Traduce unas coordenadas del navegador a la ciudad servida más próxima.
 * Se resuelve contra la posición de los restaurantes, sin geocodificador externo.
 */
export async function detectCity(lat: number, lng: number) {
  const supabase = createPublicSupabase();
  const { data, error } = await supabase.rpc('nearest_city', { p_lat: lat, p_lng: lng });

  const rows = (data ?? []) as { city: string; city_slug: string; distance_km: number }[];
  if (error || rows.length === 0) {
    return { ok: false as const, error: 'NO_CITY_NEARBY' };
  }

  return {
    ok: true as const,
    city: rows[0].city,
    citySlug: rows[0].city_slug,
    distanceKm: rows[0].distance_km,
  };
}
