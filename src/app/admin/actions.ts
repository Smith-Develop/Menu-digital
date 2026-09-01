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
import type { Enums } from '@/types/database';

// Genérico como el del panel: hay acciones que ya devuelven datos y tener dos
// convenciones distintas para lo mismo obliga a recordar cuál usa cada fichero.
export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

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
  // A quién va dirigido. Los límites de un negocio y los de un repartidor no
  // se parecen: al primero se le vende capacidad, al segundo acceso al trabajo.
  audience: z.enum(['restaurant', 'courier']).default('restaurant'),
  max_restaurants: z.coerce.number().int().min(0).nullable().optional(),
  allows_pool: z.boolean().default(true),
  pool_priority: z.coerce.number().int().min(0).max(100).default(0),
  // Comisión sobre lo cobrado. Cero deja el plan a cuota fija.
  commission_rate: z.coerce.number().min(0).max(1).default(0),
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
/**
 * Asigna un plan a un sujeto: un negocio o un repartidor.
 *
 * La suscripción dejó de pertenecer a un restaurante en la fase B, así que
 * esta acción sirve para las dos audiencias. Se comprueba que el plan sea de
 * la que toca: un plan con "máximo de mesas" no significa nada para quien
 * reparte.
 */
export async function assignPlan(
  subjectId: string,
  planId: string,
  options?: { months?: number; subjectType?: 'restaurant' | 'courier' },
): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const subjectType = options?.subjectType ?? 'restaurant';
  const supabase = await createServerSupabase();
  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle();
  if (!plan) return { ok: false, error: 'PLAN_NOT_FOUND' };
  if ((plan.audience ?? 'restaurant') !== subjectType) return { ok: false, error: 'PLAN_WRONG_AUDIENCE' };

  const start = new Date();
  let end = periodEnd(start, plan.interval);
  if (options?.months && options.months > 0) {
    end = new Date(start);
    end.setMonth(end.getMonth() + options.months);
  }

  // Sólo puede haber una viva por sujeto (índice único parcial).
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .in('status', ['trialing', 'active', 'past_due']);

  const { error } = await supabase.from('subscriptions').insert({
    subject_type: subjectType,
    subject_id: subjectId,
    plan_id: planId,
    status: 'active',
    current_period_start: start.toISOString(),
    current_period_end: end.toISOString(),
    assigned_by: admin.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin');
  revalidatePath('/admin/restaurants');
  revalidatePath('/admin/couriers');
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

/**
 * Cambia el tipo de negocio.
 *
 * No es un ajuste cosmético: enciende y apaga módulos enteros del panel, y
 * pasar a supermercado apaga el servicio en mesa —lo hace la propia base, con
 * un disparador, para que no dependa de que se acuerde el formulario—. Por eso
 * lo cambia el superadministrador y no el local: normalmente va unido a lo que
 * se le ha vendido.
 */
export async function setRestaurantBusinessType(
  restaurantId: string,
  businessType: Enums<'business_type'>,
): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('restaurants')
    .update({ business_type: businessType })
    .eq('id', restaurantId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/restaurants');
  revalidatePath('/dashboard', 'layout');
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

/**
 * Ajustes de marca.
 *
 * Todos los campos son opcionales porque el panel guarda por bloques: la
 * pestaña de colores manda sólo colores y no debería tener que reenviar el
 * nombre de la aplicación para que la validación la deje pasar. Sólo se
 * escriben las claves que llegan.
 */
const brandingSchema = z.object({
  app_name: z.string().min(1).max(40).optional(),
  tagline: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(400).optional(),
  logo_url: z.string().url().nullable().optional(),
  icon_url: z.string().url().nullable().optional(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),

  // Portadas y textos de las pantallas por las que se entra a la aplicación.
  login_image_url: z.string().url().nullable().optional(),
  login_title: z.string().max(80).nullable().optional(),
  login_subtitle: z.string().max(160).nullable().optional(),
  register_image_url: z.string().url().nullable().optional(),
  register_title: z.string().max(80).nullable().optional(),
  register_subtitle: z.string().max(160).nullable().optional(),
  splash_image_url: z.string().url().nullable().optional(),
  splash_title: z.string().max(80).nullable().optional(),
  splash_subtitle: z.string().max(160).nullable().optional(),
  splash_enabled: z.boolean().optional(),
  splash_seconds: z.coerce.number().int().min(1).max(15).optional(),
});

export async function updateBranding(input: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  // Un envío vacío sería una escritura inútil que además tocaría `updated_by`.
  if (Object.keys(parsed.data).length === 0) return { ok: true };

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
  // Un pasillo dentro de otro. Dos niveles bastan para una compra; un tercero
  // convierte la navegación en un laberinto y nadie llega al producto.
  parent_id: z.string().uuid().nullable().optional(),
  // Para qué vertical se ofrece. Nulo vale para las dos.
  business_type: z.enum(['restaurant', 'grocery']).nullable().optional(),
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
    waiterCall: z.enum(['bell', 'chime', 'ding', 'alert', 'soft', 'none']).default('alert'),
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

// =========================== Cuenta del superadmin ===========================

/**
 * Actualiza los datos de la propia cuenta del superadmin.
 *
 * La contraseña no pasa por aquí: la cambia el navegador contra Supabase con la
 * sesión ya abierta, que es la única forma de exigir la contraseña actual antes
 * de aceptar una nueva. Aquí sólo viajan nombre y correo.
 */
export async function updateOwnAdminAccount(input: {
  fullName: string;
  email: string;
}): Promise<Result> {
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

  const previousEmail = admin.email ?? null;
  const emailChanged = previousEmail !== email;

  if (emailChanged) {
    const { error } = await service.auth.admin.updateUserById(admin.id, {
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
    .eq('id', admin.id);
  if (profileError) return { ok: false, error: profileError.message };

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

  revalidatePath('/admin/account');
  return { ok: true };
}

// ============================ Banners de portada =============================

const platformBannerSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(80).nullable().optional(),
  subtitle: z.string().max(160).nullable().optional(),
  image_url: z.string().url(),
  link_url: z.string().max(400).nullable().optional(),
  is_active: z.boolean().default(true),
  is_pinned: z.boolean().default(false),
  pinned_cities: z.array(z.string()).default([]),
  position: z.coerce.number().int().min(0).default(0),
});

/**
 * Banner propio de la plataforma en la portada.
 *
 * Va sin restaurante: eso es lo que lo distingue de los que publica cada local.
 * Si se marca como el que abre, deja de estarlo cualquier otro que compitiera
 * por las mismas ciudades; dos banners disputándose el primer puesto darían un
 * orden impredecible.
 */
export async function savePlatformBanner(input: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const parsed = platformBannerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { id, ...values } = parsed.data;
  const supabase = await createServerSupabase();

  if (values.is_pinned) {
    const { data: fijados } = await supabase
      .from('banners')
      .select('id, pinned_cities')
      .is('restaurant_id', null)
      .eq('is_pinned', true);

    const chocan = (fijados ?? [])
      .filter((otro) => otro.id !== id)
      .filter((otro) => {
        // Sin ciudades, un banner manda en todas: choca con cualquiera.
        if (otro.pinned_cities.length === 0 || values.pinned_cities.length === 0) return true;
        return otro.pinned_cities.some((ciudad) => values.pinned_cities.includes(ciudad));
      })
      .map((otro) => otro.id);

    if (chocan.length) {
      await supabase.from('banners').update({ is_pinned: false }).in('id', chocan);
    }
  }

  const { error } = id
    ? await supabase.from('banners').update(values).eq('id', id).is('restaurant_id', null)
    : await supabase.from('banners').insert({ ...values, restaurant_id: null });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/banners');
  revalidatePath('/');
  return { ok: true };
}

export async function deletePlatformBanner(id: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('banners')
    .delete()
    .eq('id', id)
    .is('restaurant_id', null);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/banners');
  revalidatePath('/');
  return { ok: true };
}

/** Cada cuántos segundos pasa solo el carrusel de la portada. */
export async function updateBannerRotation(seconds: number): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const valor = Math.min(Math.max(Math.round(seconds), 2), 30);
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('app_settings')
    .update({ banner_rotation_seconds: valor, updated_by: admin.id })
    .eq('id', true);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/banners');
  revalidatePath('/');
  return { ok: true };
}

// ====================== Presentación de bienvenida =======================

const slideSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(80),
  subtitle: z.string().max(200).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  position: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

/** Una de las pantallas que se enseñan al abrir la aplicación por primera vez. */
export async function saveOnboardingSlide(input: unknown): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const parsed = slideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const { id, ...values } = parsed.data;
  const supabase = await createServerSupabase();

  const { error } = id
    ? await supabase.from('onboarding_slides').update(values).eq('id', id)
    : await supabase.from('onboarding_slides').insert(values);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/branding');
  revalidatePath('/welcome');
  return { ok: true };
}

export async function deleteOnboardingSlide(id: string): Promise<Result> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('onboarding_slides').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/branding');
  revalidatePath('/welcome');
  return { ok: true };
}

// ========================= Comisiones de la plataforma =========================

/**
 * Cierra lo devengado de un local o de un repartidor.
 *
 * Agrupa las líneas pendientes en una liquidación con su importe y su fecha. No
 * borra nada: las líneas quedan marcadas, que es lo que permite reconstruir
 * después de dónde salió cada euro.
 */
export async function settlePlatformCommissions(
  subjectType: 'restaurant' | 'courier',
  subjectId: string,
  note?: string | null,
): Promise<Result<{ amountCents: number; lines: number }>> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('settle_platform_commissions', {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_note: note?.trim() || null,
  });

  if (error) return { ok: false, error: error.message };

  const r = data as { amount_cents?: number; lines?: number } | null;
  revalidatePath('/admin');
  revalidatePath('/admin/revenue');
  return { ok: true, data: { amountCents: r?.amount_cents ?? 0, lines: r?.lines ?? 0 } };
}

// ===================== Facturación de la plataforma =====================

const billingSchema = z.object({
  legal_name: z.string().max(120).nullable().optional(),
  tax_id: z.string().max(40).nullable().optional(),
  fiscal_address: z.string().max(200).nullable().optional(),
  invoice_series: z.string().min(1).max(8).optional(),
  invoice_note: z.string().max(200).nullable().optional(),
});

/**
 * Los datos con los que la plataforma factura a sus clientes.
 *
 * Van aquí y no en la marca porque no son apariencia: sin identificación fiscal
 * del emisor no se puede emitir ninguna factura, y la función de la base se
 * niega a hacerlo.
 */
export async function updatePlatformBilling(input: unknown): Promise<Result> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const parsed = billingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('app_settings').update(parsed.data).eq('id', true);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/revenue');
  return { ok: true };
}

/** Emite la factura de una liquidación ya cerrada. */
export async function issuePlatformInvoice(
  settlementId: string,
  taxRate = 0,
): Promise<Result<{ fullNumber: string; already: boolean }>> {
  if (!(await requireAdmin())) return { ok: false, error: 'FORBIDDEN' };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('issue_platform_invoice', {
    p_settlement_id: settlementId,
    p_tax_rate: taxRate,
  });

  if (error) {
    return {
      ok: false,
      error: error.message.includes('PLATFORM_TAX_ID_MISSING')
        ? 'PLATFORM_TAX_ID_MISSING'
        : error.message,
    };
  }

  const r = data as { full_number: string; already?: boolean };
  revalidatePath('/admin/revenue');
  return { ok: true, data: { fullNumber: r.full_number, already: Boolean(r.already) } };
}
