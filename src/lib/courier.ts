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

// Los vehículos viven en courier-vehicles.ts para que el formulario de alta,
// que es cliente, no arrastre las APIs de servidor de este módulo.
export { VEHICLES, isVehicle } from '@/lib/courier-vehicles';
export type { Vehicle } from '@/lib/courier-vehicles';
