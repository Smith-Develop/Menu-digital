import { cache } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSessionProfile } from '@/lib/auth';
import type { Tables } from '@/types/database';

export type Courier = Tables<'couriers'>;

/** Ficha de repartidor del usuario actual, si la tiene. */
export const getCourierProfile = cache(async (): Promise<Courier | null> => {
  const profile = await getSessionProfile();
  if (!profile) return null;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('couriers')
    .select('*')
    .eq('user_id', profile.id)
    .maybeSingle();

  return data ?? null;
});

export const VEHICLES = ['foot', 'bike', 'moto', 'car'] as const;
export type Vehicle = (typeof VEHICLES)[number];

export function isVehicle(value: unknown): value is Vehicle {
  return typeof value === 'string' && (VEHICLES as readonly string[]).includes(value);
}
