'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSessionProfile } from '@/lib/auth';
import { periodEnd } from '@/lib/stripe';

export type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== 'superadmin') return null;
  return profile;
}

// ================================ Planes ================================

const planSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(400).nullable().optional(),
  interval: z.enum(['month', 'year']),
  price_cents: z.coerce.number().int().min(0),
  currency: z.string().length(3),
  trial_days: z.coerce.number().int().min(0).max(365),
  max_tables: z.coerce.number().int().min(0).nullable(),
  max_products: z.coerce.number().int().min(0).nullable(),
  max_staff: z.coerce.number().int().min(0).nullable(),
  allows_3d: z.boolean(),
  allows_delivery: z.boolean(),
  features: z.array(z.string()).default([]),
  stripe_price_id: z.string().max(120).nullable().optional(),
  is_active: z.boolean(),
  position: z.coerce.number().int().min(0).default(0),
});

export async function savePlan(input: unknown): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const { id, ...values } = parsed.data;

  const { error } = id
    ? await supabase.from('plans').update(values).eq('id', id)
    : await supabase.from('plans').insert(values);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/plans');
  return { ok: true };
}

export async function deletePlan(id: string): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('plans').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/plans');
  return { ok: true };
}

// ============================ Suscripciones =============================

/**
 * Asigna un plan a un restaurante y abre un periodo nuevo.
 * Es la vía manual, para altas fuera de Stripe (transferencia, acuerdo, prueba).
 */
export async function assignPlan(
  restaurantId: string,
  planId: string,
  options?: { months?: number },
): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!plan) return { ok: false, error: 'PLAN_NOT_FOUND' };

  const start = new Date();
  let end = periodEnd(start, plan.interval);
  if (options?.months && options.months > 0) {
    end = new Date(start);
    end.setMonth(end.getMonth() + options.months);
  }

  // Sólo puede haber una suscripción viva por restaurante (índice único parcial).
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('restaurant_id', restaurantId)
    .in('status', ['trialing', 'active', 'past_due']);

  const { error } = await supabase.from('subscriptions').insert({
    restaurant_id: restaurantId,
    plan_id: planId,
    status: 'active',
    current_period_start: start.toISOString(),
    current_period_end: end.toISOString(),
    assigned_by: admin.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/admin/restaurants');
  return { ok: true };
}

export async function extendSubscription(subscriptionId: string, days: number): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('current_period_end')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (!subscription) return { ok: false, error: 'NOT_FOUND' };

  // Si ya caducó, contamos desde hoy; si no, desde el final del periodo actual.
  const current = new Date(subscription.current_period_end);
  const from = current.getTime() > Date.now() ? current : new Date();
  from.setDate(from.getDate() + days);

  const { error } = await supabase
    .from('subscriptions')
    .update({ current_period_end: from.toISOString(), status: 'active' })
    .eq('id', subscriptionId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/restaurants');
  return { ok: true };
}

export async function cancelSubscription(subscriptionId: string): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: true })
    .eq('id', subscriptionId);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/restaurants');
  return { ok: true };
}

// ============================= Restaurantes =============================

export async function setRestaurantActive(
  restaurantId: string,
  isActive: boolean,
): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('restaurants')
    .update({ is_active: isActive })
    .eq('id', restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/admin/restaurants');
  return { ok: true };
}

/** Añade a alguien al equipo de un restaurante buscándolo por su correo. */
export async function addStaffByEmail(
  restaurantId: string,
  email: string,
  role: 'owner' | 'admin' | 'manager' | 'waiter' | 'kitchen' | 'cashier',
): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (!profile) return { ok: false, error: 'USER_NOT_FOUND' };

  const { error } = await supabase
    .from('restaurant_staff')
    .upsert(
      { restaurant_id: restaurantId, user_id: profile.id, role, is_active: true },
      { onConflict: 'restaurant_id,user_id' },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/restaurants');
  revalidatePath('/dashboard/staff');
  return { ok: true };
}

// ========================= Marca de la aplicación ========================

const brandingSchema = z.object({
  app_name: z.string().min(1).max(40),
  tagline: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  logo_url: z.string().url().nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function updateBranding(input: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('app_settings')
    .update({ ...parsed.data, updated_by: admin.id })
    .eq('id', true);

  if (error) return { ok: false, error: error.message };

  // La marca pinta toda la interfaz y el manifiesto de la PWA.
  revalidatePath('/', 'layout');
  return { ok: true };
}

// ============================ Notificaciones =============================

const notificationSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(80),
  body: z.string().max(400).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  link_url: z.string().max(400).nullable().optional(),
  link_label: z.string().max(40).nullable().optional(),
  audience: z.enum(['all', 'cities']),
  cities: z.array(z.string()).default([]),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function saveNotification(input: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const parsed = notificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { id, ...values } = parsed.data;
  if (values.audience === 'cities' && values.cities.length === 0) {
    return { ok: false, error: 'CITIES_REQUIRED' };
  }

  const supabase = await createServerSupabase();
  const { error } = id
    ? await supabase.from('notifications').update(values).eq('id', id)
    : await supabase.from('notifications').insert({ ...values, created_by: admin.id });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/notifications');
  revalidatePath('/');
  return { ok: true };
}

export async function deleteNotification(id: string): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/notifications');
  revalidatePath('/');
  return { ok: true };
}
