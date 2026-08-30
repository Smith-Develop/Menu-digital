'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSessionProfile, requireStaffContext } from '@/lib/auth';
import { canManageStaff } from '@/lib/auth-permissions';
import { isVehicle } from '@/lib/courier';

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

/** Alta del propio usuario como repartidor. */
export async function registerAsCourier(input: {
  phone?: string | null;
  vehicle: string;
  city?: string | null;
}): Promise<Result> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'NOT_AUTHENTICATED' };
  if (!isVehicle(input.vehicle)) return { ok: false, error: 'INVALID_VEHICLE' };

  const supabase = await createServerSupabase();

  const { error } = await supabase.from('couriers').upsert(
    {
      user_id: profile.id,
      phone: input.phone?.trim() || profile.phone,
      vehicle: input.vehicle,
      city: input.city?.trim() || null,
      status: 'offline',
      is_active: true,
    },
    { onConflict: 'user_id' },
  );

  if (error) return { ok: false, error: error.message };

  // El rol global solo se eleva si el usuario todavía era un cliente:
  // un dueño de restaurante que además reparte no debe perder su rol.
  if (profile.role === 'customer') {
    await supabase.from('profiles').update({ role: 'courier' }).eq('id', profile.id);
  }

  revalidatePath('/courier');
  return { ok: true };
}

export async function setCourierStatus(status: 'offline' | 'available' | 'busy'): Promise<Result> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'NOT_AUTHENTICATED' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('couriers')
    .update({ status })
    .eq('user_id', profile.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/courier');
  return { ok: true };
}

export async function updateCourierProfile(input: {
  phone?: string | null;
  vehicle?: string;
  city?: string | null;
}): Promise<Result> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'NOT_AUTHENTICATED' };
  if (input.vehicle && !isVehicle(input.vehicle)) return { ok: false, error: 'INVALID_VEHICLE' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('couriers')
    .update({
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.vehicle ? { vehicle: input.vehicle } : {}),
      ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
    })
    .eq('user_id', profile.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/courier');
  return { ok: true };
}

/** El repartidor se da de baja de un restaurante. */
export async function leaveRestaurant(linkId: string): Promise<Result> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: 'NOT_AUTHENTICATED' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('restaurant_couriers').delete().eq('id', linkId);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/courier');
  return { ok: true };
}

// ---------- Desde el panel del restaurante ----------

/** El restaurante añade a su equipo un repartidor ya registrado. */
export async function addCourierToRestaurant(email: string): Promise<Result> {
  const context = await requireStaffContext();
  if (!canManageStaff(context.staffRole)) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();

  const { data: person } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (!person) return { ok: false, error: 'COURIER_NOT_FOUND' };

  const { data: courier } = await supabase
    .from('couriers')
    .select('id')
    .eq('user_id', person.id)
    .maybeSingle();

  if (!courier) return { ok: false, error: 'COURIER_NOT_FOUND' };

  const { data: existing } = await supabase
    .from('restaurant_couriers')
    .select('id, is_active')
    .eq('restaurant_id', context.restaurant.id)
    .eq('courier_id', courier.id)
    .maybeSingle();

  if (existing?.is_active) return { ok: false, error: 'ALREADY_LINKED' };

  const { error } = existing
    ? await supabase.from('restaurant_couriers').update({ is_active: true }).eq('id', existing.id)
    : await supabase
        .from('restaurant_couriers')
        .insert({ restaurant_id: context.restaurant.id, courier_id: courier.id });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/couriers');
  return { ok: true };
}

export async function removeCourierFromRestaurant(linkId: string): Promise<Result> {
  const context = await requireStaffContext();
  if (!canManageStaff(context.staffRole)) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('restaurant_couriers')
    .delete()
    .eq('id', linkId)
    .eq('restaurant_id', context.restaurant.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/couriers');
  return { ok: true };
}

/** El restaurante asigna un pedido concreto a uno de sus repartidores. */
export async function assignOrderToCourier(orderId: string, courierId: string): Promise<Result> {
  const context = await requireStaffContext();
  const supabase = await createServerSupabase();

  const { data: link } = await supabase
    .from('restaurant_couriers')
    .select('id')
    .eq('restaurant_id', context.restaurant.id)
    .eq('courier_id', courierId)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) return { ok: false, error: 'COURIER_NOT_IN_TEAM' };

  const { error } = await supabase
    .from('orders')
    .update({ courier_id: courierId })
    .eq('id', orderId)
    .eq('restaurant_id', context.restaurant.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard/orders');
  return { ok: true };
}
