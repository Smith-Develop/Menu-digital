import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import type { Tables, Enums } from '@/types/database';

export type Profile = Tables<'profiles'>;
export type Restaurant = Tables<'restaurants'>;

export type StaffContext = {
  profile: Profile;
  restaurant: Restaurant;
  staffRole: Enums<'staff_role'>;
  subscription: (Tables<'subscriptions'> & { plan: Tables<'plans'> | null }) | null;
};

/** Usuario y perfil de la petición actual. `cache` evita repetir la consulta por render. */
export const getSessionProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return data ?? null;
});

export async function requireProfile(nextPath = '/dashboard'): Promise<Profile> {
  const profile = await getSessionProfile();
  if (!profile) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return profile;
}

export async function requireSuperadmin(): Promise<Profile> {
  const profile = await requireProfile('/admin');
  if (profile.role !== 'superadmin') redirect('/dashboard');
  return profile;
}

/**
 * Restaurante sobre el que trabaja el usuario actual.
 * Un usuario puede ser dueño de uno y empleado de otro: se prioriza la propiedad.
 */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createServerSupabase();
  const profile = await getSessionProfile();
  if (!profile) return null;

  const { data: owned } = await supabase
    .from('restaurants')
    .select('*')
    .eq('owner_id', profile.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let restaurant: Restaurant | null = owned ?? null;
  let staffRole: Enums<'staff_role'> = 'owner';

  if (!restaurant) {
    // Consultas separadas en lugar de un join anidado: los tipos generados no
    // llevan Relationships, así que supabase-js no podría inferir el embebido.
    const { data: membership } = await supabase
      .from('restaurant_staff')
      .select('role, restaurant_id')
      .eq('user_id', profile.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!membership) return null;

    const { data: staffRestaurant } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', membership.restaurant_id)
      .maybeSingle();

    if (!staffRestaurant) return null;
    restaurant = staffRestaurant;
    staffRole = membership.role;
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let plan: Tables<'plans'> | null = null;
  if (subscription?.plan_id) {
    const { data } = await supabase.from('plans').select('*').eq('id', subscription.plan_id).maybeSingle();
    plan = data ?? null;
  }

  return {
    profile,
    restaurant,
    staffRole,
    subscription: subscription ? { ...subscription, plan } : null,
  };
});

export async function requireStaffContext(): Promise<StaffContext> {
  const profile = await requireProfile();
  const context = await getStaffContext();
  if (!context) {
    // Sesión válida pero sin restaurante: hay que crearlo antes de entrar al panel.
    redirect(profile.role === 'superadmin' ? '/admin' : '/onboarding');
  }
  return context;
}

// Los permisos por rol viven en lib/auth-permissions.ts para que el cliente
// pueda usarlos sin arrastrar las APIs de servidor de este módulo.
export { canManageMenu, canManageStaff, canManageBilling, canWorkKitchen } from '@/lib/auth-permissions';

/** Días que quedan de suscripción. Negativo = caducada. */
export function daysUntil(date: string | null | undefined): number {
  if (!date) return 0;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

export function subscriptionIsLive(sub: StaffContext['subscription']): boolean {
  if (!sub) return true; // Sin suscripción asignada todavía: no bloqueamos la carta.
  if (!['trialing', 'active', 'past_due'].includes(sub.status)) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}
