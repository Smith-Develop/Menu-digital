'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isoDateTime } from '@/lib/validation';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { getBrand } from '@/lib/brand';
import { sendMail } from '@/lib/mailer';
import { emailChangedNotice } from '@/lib/emails/account-notices';
import { sendPasswordResetFor } from '@/lib/password-reset';
import { sendBroadcastPush } from '@/lib/push';
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
  starts_at: isoDateTime().optional(),
  ends_at: isoDateTime().nullable().optional(),
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

  // El push sale sólo al crear un aviso activo, nunca al editarlo: corregir una
  // errata no debe volver a sonar en el móvil de todo el mundo.
  if (!id && values.is_active) {
    void sendBroadcastPush(
      {
        title: values.title,
        body: values.body ?? '',
        url: values.link_url ?? '/',
        tag: 'yumi-aviso',
      },
      values.audience === 'cities' ? values.cities : null,
    ).catch(() => undefined);
  }

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

// ====================== Catálogo de categorías ==========================

const catalogCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  description: z.string().max(200).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  position: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

/**
 * Alta y edición del catálogo de categorías.
 *
 * Lo mantiene el superadministrador porque es lo que agrupa platos de
 * restaurantes distintos en la portada: si cada local inventara las suyas,
 * "Pizzas" y "Pizza" serían dos filtros que no se cruzan.
 */
export async function saveCatalogCategory(input: unknown): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const parsed = catalogCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const { id, ...values } = parsed.data;

  const { error } = id
    ? await supabase.from('catalog_categories').update(values).eq('id', id)
    : await supabase.from('catalog_categories').insert(values);

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'SLUG_TAKEN' : error.message };
  }

  revalidatePath('/admin/categories');
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function deleteCatalogCategory(id: string): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();

  // Los platos que la usaban quedan sin categoría, no se borran.
  const { count } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('catalog_category_id', id);

  const { error } = await supabase.from('catalog_categories').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/categories');
  revalidatePath('/', 'layout');
  return { ok: true, ...(count ? { orphaned: count } : {}) } as Result;
}

/** Avisos sonoros por defecto de la plataforma. */
export async function updatePlatformSounds(value: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const schema = z.object({
    newOrder: z.enum(['bell', 'chime', 'ding', 'alert', 'soft', 'none']),
    orderReady: z.enum(['bell', 'chime', 'ding', 'alert', 'soft', 'none']),
    volume: z.coerce.number().min(0).max(1),
    enabled: z.boolean(),
  });

  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('app_settings')
    .update({ sound_settings: parsed.data })
    .eq('id', true);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/branding');
  return { ok: true };
}

// ====================== Ficha del restaurante ===========================

/**
 * Cambia el correo del dueño de un restaurante.
 *
 * Se avisa a las dos direcciones: a la vieja, porque es la única forma de que
 * el titular se entere si alguien le cambia el acceso; a la nueva, para que
 * sepa con qué cuenta entra a partir de ahora.
 */
export async function changeOwnerEmail(userId: string, newEmail: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const email = newEmail.trim().toLowerCase();
  if (!email.includes('@')) return { ok: false, error: 'INVALID_EMAIL' };

  let service: ReturnType<typeof createAdminSupabase>;
  try {
    service = createAdminSupabase();
  } catch {
    return { ok: false, error: 'SERVICE_ROLE_MISSING' };
  }

  const { data: current } = await service
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle();

  const previousEmail = current?.email ?? null;
  if (previousEmail === email) return { ok: true };

  const { error } = await service.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (error) {
    return { ok: false, error: /exists|registered/i.test(error.message) ? 'EMAIL_TAKEN' : error.message };
  }

  await service.from('profiles').update({ email }).eq('id', userId);

  const brand = await getBrand();
  const notice = emailChangedNotice({
    appName: brand.appName,
    brandColor: brand.primaryColor,
    fullName: current?.full_name ?? email,
    previousEmail,
    newEmail: email,
  });

  if (previousEmail) void sendMail({ to: previousEmail, ...notice.toPrevious });
  void sendMail({ to: email, ...notice.toNew });

  revalidatePath('/admin/restaurants');
  return { ok: true };
}

/** Envía un enlace de restablecimiento de contraseña. */
export async function sendPasswordReset(email: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };
  return sendPasswordResetFor(email);
}

/**
 * Edita la ficha de un repartidor. Sólo el superadmin llega aquí: los
 * repartidores trabajan para varios restaurantes, así que ninguno de ellos
 * debe poder tocarles la cuenta. Para cambiar su propia contraseña tienen
 * "He olvidado mi contraseña" en la pantalla de acceso.
 *
 * Igual que con los dueños, al cambiar el correo se avisa a la dirección
 * anterior y a la nueva.
 */
export async function updateCourier(
  userId: string,
  input: {
    fullName: string;
    email: string;
    phone?: string | null;
    vehicle?: string | null;
    isActive?: boolean;
  },
): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName) return { ok: false, error: 'NAME_REQUIRED' };
  if (!email.includes('@')) return { ok: false, error: 'INVALID_EMAIL' };

  let service: ReturnType<typeof createAdminSupabase>;
  try {
    service = createAdminSupabase();
  } catch {
    return { ok: false, error: 'SERVICE_ROLE_MISSING' };
  }

  const { data: current } = await service
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  const previousEmail = current?.email ?? null;
  const emailChanged = previousEmail !== email;

  if (emailChanged) {
    const { error } = await service.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (error) {
      return { ok: false, error: /exists|registered/i.test(error.message) ? 'EMAIL_TAKEN' : error.message };
    }
  }

  const { error: profileError } = await service
    .from('profiles')
    .update({ full_name: fullName, email })
    .eq('id', userId);
  if (profileError) return { ok: false, error: profileError.message };

  const courierPatch: Record<string, unknown> = {};
  if (input.phone !== undefined) courierPatch.phone = input.phone?.trim() || null;
  if (input.vehicle !== undefined) courierPatch.vehicle = input.vehicle || null;
  if (input.isActive !== undefined) courierPatch.is_active = input.isActive;

  if (Object.keys(courierPatch).length) {
    const { error } = await service.from('couriers').update(courierPatch).eq('user_id', userId);
    if (error) return { ok: false, error: error.message };
  }

  if (emailChanged) {
    const brand = await getBrand();
    const notice = emailChangedNotice({
      appName: brand.appName,
      brandColor: brand.primaryColor,
      fullName,
      previousEmail,
      newEmail: email,
    });
    if (previousEmail) void sendMail({ to: previousEmail, ...notice.toPrevious });
    void sendMail({ to: email, ...notice.toNew });
  }

  revalidatePath('/admin/couriers');
  return { ok: true };
}
