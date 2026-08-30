'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireStaffContext } from '@/lib/auth';
import { canManageMenu, canManageStaff } from '@/lib/auth-permissions';
import { tableCode as makeTableCode } from '@/lib/utils';
import { getCurrency } from '@/lib/money';
import { sendMail } from '@/lib/mailer';
import { staffInvitationEmail } from '@/lib/emails/staff-invitation';
import { getPublicOrigin } from '@/lib/request-url';
import { getBrand } from '@/lib/brand';
import { getI18n } from '@/i18n';

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Comprueba sesión + permiso y devuelve el restaurante del usuario. */
async function guard(kind: 'menu' | 'staff' = 'menu') {
  const context = await requireStaffContext();
  const allowed = kind === 'staff' ? canManageStaff(context.staffRole) : canManageMenu(context.staffRole);
  if (!allowed) return { context: null, error: 'FORBIDDEN' as const };
  return { context, error: null };
}

// ============================== Categorías ==============================

const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional().nullable(),
  image_url: z.string().url().optional().nullable(),
  position: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

export async function saveCategory(input: unknown): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');

  const supabase = await createServerSupabase();
  const { id, ...values } = parsed.data;

  const { error: dbError } = id
    ? await supabase.from('categories').update(values).eq('id', id).eq('restaurant_id', context.restaurant.id)
    : await supabase.from('categories').insert({ ...values, restaurant_id: context.restaurant.id });

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/menu');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/menu');
  return { ok: true };
}

// =============================== Platos =================================

const productSchema = z.object({
  id: z.string().uuid().optional(),
  category_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(600).nullable().optional(),
  price_cents: z.coerce.number().int().min(0),
  image_url: z.string().url().nullable().optional(),
  model_3d_url: z.string().url().nullable().optional(),
  model_ar_url: z.string().url().nullable().optional(),
  model_scale: z.coerce.number().min(0.01).max(50).default(1),
  prep_minutes: z.coerce.number().int().min(0).max(600).default(15),
  calories: z.coerce.number().int().min(0).nullable().optional(),
  ingredients: z.array(z.string()).default([]),
  allergens: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  is_available: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  position: z.coerce.number().int().min(0).default(0),
});

export async function saveProduct(input: unknown): Promise<Result<{ id: string }>> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');

  const supabase = await createServerSupabase();
  const { id, ...values } = parsed.data;

  // Límite de platos del plan contratado.
  if (!id) {
    const max = context.subscription?.plan?.max_products ?? null;
    if (max !== null) {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', context.restaurant.id);
      if ((count ?? 0) >= max) return fail('PLAN_LIMIT_PRODUCTS');
    }
  }

  // El modelo 3D es una función de pago.
  if (values.model_3d_url && context.subscription?.plan && !context.subscription.plan.allows_3d) {
    return fail('PLAN_NO_3D');
  }

  const { data, error: dbError } = id
    ? await supabase
        .from('products')
        .update(values)
        .eq('id', id)
        .eq('restaurant_id', context.restaurant.id)
        .select('id')
        .maybeSingle()
    : await supabase
        .from('products')
        .insert({ ...values, restaurant_id: context.restaurant.id })
        .select('id')
        .maybeSingle();

  if (dbError || !data) return fail(dbError?.message ?? 'NOT_SAVED');

  revalidatePath('/dashboard/menu');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true, data: { id: data.id } };
}

export async function deleteProduct(id: string): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/menu');
  return { ok: true };
}

export async function toggleProductAvailability(id: string, available: boolean): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('products')
    .update({ is_available: available })
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/menu');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true };
}

// ========================= Opciones del plato ===========================

const optionGroupSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  min_select: z.coerce.number().int().min(0).max(20).default(0),
  max_select: z.coerce.number().int().min(1).max(20).default(1),
  is_required: z.boolean().default(false),
  position: z.coerce.number().int().min(0).default(0),
  options: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(80),
        price_delta_cents: z.coerce.number().int().default(0),
        is_default: z.boolean().default(false),
        is_available: z.boolean().default(true),
      }),
    )
    .default([]),
});

/** Guarda el grupo y reemplaza sus opciones en bloque. */
export async function saveOptionGroup(input: unknown): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const parsed = optionGroupSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');

  const supabase = await createServerSupabase();
  const { id, options, product_id, ...group } = parsed.data;

  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', product_id)
    .eq('restaurant_id', context.restaurant.id)
    .maybeSingle();
  if (!product) return fail('PRODUCT_NOT_FOUND');

  const { data: saved, error: groupError } = id
    ? await supabase.from('option_groups').update(group).eq('id', id).select('id').maybeSingle()
    : await supabase
        .from('option_groups')
        .insert({ ...group, product_id })
        .select('id')
        .maybeSingle();

  if (groupError || !saved) return fail(groupError?.message ?? 'NOT_SAVED');

  await supabase.from('options').delete().eq('group_id', saved.id);
  if (options.length > 0) {
    const { error: optionsError } = await supabase.from('options').insert(
      options.map((option, index) => ({
        group_id: saved.id,
        name: option.name,
        price_delta_cents: option.price_delta_cents,
        is_default: option.is_default,
        is_available: option.is_available,
        position: index,
      })),
    );
    if (optionsError) return fail(optionsError.message);
  }

  revalidatePath('/dashboard/menu');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true };
}

export async function deleteOptionGroup(id: string): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase.from('option_groups').delete().eq('id', id);
  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/menu');
  return { ok: true };
}

// ================================ Mesas =================================

export async function createTable(input: {
  name: string;
  zone?: string | null;
  seats?: number;
}): Promise<Result<{ code: string }>> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const name = input.name.trim();
  if (!name) return fail('NAME_REQUIRED');

  const supabase = await createServerSupabase();

  const max = context.subscription?.plan?.max_tables ?? null;
  if (max !== null) {
    const { count } = await supabase
      .from('tables')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', context.restaurant.id);
    if ((count ?? 0) >= max) return fail('PLAN_LIMIT_TABLES');
  }

  const { data, error: dbError } = await supabase
    .from('tables')
    .insert({
      restaurant_id: context.restaurant.id,
      code: makeTableCode(context.restaurant.slug, name),
      name,
      zone: input.zone?.trim() || null,
      seats: input.seats ?? 4,
    })
    .select('code')
    .maybeSingle();

  if (dbError || !data) return fail(dbError?.message ?? 'NOT_SAVED');

  revalidatePath('/dashboard/tables');
  return { ok: true, data: { code: data.code } };
}

export async function updateTable(
  id: string,
  values: { name?: string; zone?: string | null; seats?: number; is_active?: boolean },
): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('tables')
    .update(values)
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/tables');
  return { ok: true };
}

export async function deleteTable(id: string): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('tables')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/tables');
  return { ok: true };
}

// ========================== Ajustes del local ===========================

const settingsSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  country: z.string().length(2).optional(),
  logo_url: z.string().url().nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  currency: z.string().length(3),
  timezone: z.string().max(60),
  cuisine_tags: z.array(z.string()).default([]),
  avg_prep_minutes: z.coerce.number().int().min(1).max(240),
  delivery_fee_cents: z.coerce.number().int().min(0),
  min_order_cents: z.coerce.number().int().min(0),
  tax_rate: z.coerce.number().min(0).max(1),
  dinein_enabled: z.boolean(),
  delivery_enabled: z.boolean(),
  pickup_enabled: z.boolean(),
  accepts_cash: z.boolean(),
  accepts_card: z.boolean(),
  accepts_tpv: z.boolean(),
  is_open: z.boolean(),
});

export async function updateRestaurantSettings(input: unknown): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');

  const currency = getCurrency(parsed.data.currency);
  const supabase = await createServerSupabase();

  const { error: dbError } = await supabase
    .from('restaurants')
    .update({
      ...parsed.data,
      currency: currency.code,
      currency_decimals: currency.decimals,
    })
    .eq('id', context.restaurant.id);

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/settings');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true };
}

export async function toggleRestaurantOpen(isOpen: boolean): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurants')
    .update({ is_open: isOpen })
    .eq('id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true };
}

// ================================ Equipo ================================

export async function updateStaffRole(
  staffId: string,
  role: 'owner' | 'admin' | 'manager' | 'waiter' | 'kitchen' | 'cashier',
): Promise<Result> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurant_staff')
    .update({ role })
    .eq('id', staffId)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/staff');
  return { ok: true };
}

export async function setStaffActive(staffId: string, isActive: boolean): Promise<Result> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurant_staff')
    .update({ is_active: isActive })
    .eq('id', staffId)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/staff');
  return { ok: true };
}

export async function removeStaff(staffId: string): Promise<Result> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurant_staff')
    .delete()
    .eq('id', staffId)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/staff');
  return { ok: true };
}

// ================================ Pedidos ===============================

export async function updateOrderStatus(
  orderId: string,
  status: 'confirmed' | 'preparing' | 'ready' | 'delivering' | 'completed' | 'cancelled',
): Promise<Result> {
  const context = await requireStaffContext();
  const supabase = await createServerSupabase();

  const { error: dbError } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true };
}

export async function updateOrderPaymentStatus(
  orderId: string,
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded',
): Promise<Result> {
  const context = await requireStaffContext();
  const supabase = await createServerSupabase();

  const { error: dbError } = await supabase
    .from('orders')
    .update({ payment_status: paymentStatus })
    .eq('id', orderId)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);
  revalidatePath('/dashboard/orders');
  return { ok: true };
}

// =============================== Banners ================================

const bannerSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(80).nullable().optional(),
  subtitle: z.string().max(160).nullable().optional(),
  image_url: z.string().url(),
  link_url: z.string().max(400).nullable().optional(),
  position: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
});

export async function saveBanner(input: unknown): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const parsed = bannerSchema.safeParse(input);
  if (!parsed.success) return fail('INVALID_INPUT');

  const supabase = await createServerSupabase();
  const { id, ...values } = parsed.data;

  const { error: dbError } = id
    ? await supabase
        .from('banners')
        .update(values)
        .eq('id', id)
        .eq('restaurant_id', context.restaurant.id)
    : await supabase.from('banners').insert({ ...values, restaurant_id: context.restaurant.id });

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/banners');
  revalidatePath(`/r/${context.restaurant.slug}`);
  revalidatePath('/');
  return { ok: true };
}

export async function deleteBanner(id: string): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('banners')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/banners');
  revalidatePath('/');
  return { ok: true };
}

/** Colores propios de la tienda del restaurante. */
export async function updateRestaurantTheme(input: {
  primary_color: string;
  accent_color: string;
  text_color: string;
}): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const hex = /^#[0-9a-fA-F]{6}$/;
  if (![input.primary_color, input.accent_color, input.text_color].every((c) => hex.test(c))) {
    return fail('INVALID_COLOR');
  }

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurants')
    .update({
      primary_color: input.primary_color,
      accent_color: input.accent_color,
      text_color: input.text_color,
    })
    .eq('id', context.restaurant.id);

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/settings');
  revalidatePath(`/r/${context.restaurant.slug}`);
  return { ok: true };
}

// ========================= Invitaciones de equipo =======================

/**
 * Invita a alguien al equipo.
 *
 * No se le crea la cuenta: se genera un enlace que la persona abre para
 * registrarse o iniciar sesión con su propio correo. Así el restaurante nunca
 * maneja contraseñas ajenas y no hace falta la clave de administración de
 * Supabase en el servidor de la aplicación.
 */
export async function inviteStaff(input: {
  email: string;
  role: 'admin' | 'manager' | 'waiter' | 'kitchen' | 'cashier';
  asCourier?: boolean;
}): Promise<Result<{ token: string; emailSent: boolean }>> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) return fail('INVALID_EMAIL');

  const supabase = await createServerSupabase();

  const max = context.subscription?.plan?.max_staff ?? null;
  if (max !== null) {
    const { count } = await supabase
      .from('restaurant_staff')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', context.restaurant.id)
      .eq('is_active', true);
    if ((count ?? 0) >= max) return fail('PLAN_LIMIT_STAFF');
  }

  // Un token largo y aleatorio: el enlace es la credencial de la invitación.
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');

  const { error: dbError } = await supabase.from('staff_invitations').insert({
    restaurant_id: context.restaurant.id,
    email,
    role: input.role,
    as_courier: input.asCourier ?? false,
    token,
    invited_by: context.profile.id,
  });

  if (dbError) return fail(dbError.message);

  // El correo es un extra: si el SMTP falla, la invitación sigue creada y el
  // panel muestra el enlace para pasarlo a mano.
  const [origin, brand, { t }] = await Promise.all([getPublicOrigin(), getBrand(), getI18n()]);
  const inviteUrl = `${origin.replace(/\/$/, '')}/join/${token}`;

  const message = staffInvitationEmail({
    restaurantName: context.restaurant.name,
    restaurantLogo: context.restaurant.logo_url,
    role: input.role,
    asCourier: input.asCourier ?? false,
    inviteUrl,
    brandColor: context.restaurant.primary_color,
    appName: brand.appName,
    t,
  });

  const mail = await sendMail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: context.restaurant.email ?? undefined,
  });

  revalidatePath('/dashboard/staff');
  return { ok: true, data: { token, emailSent: mail.ok } };
}

export async function revokeInvitation(id: string): Promise<Result> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('staff_invitations')
    .delete()
    .eq('id', id)
    .eq('restaurant_id', context.restaurant.id)
    .is('accepted_at', null);

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/staff');
  return { ok: true };
}

// ========================= Ajustes de impresión =========================

export async function updatePrintSettings(input: {
  paper: '58mm' | '80mm' | 'a4';
  autoPrint: boolean;
  copies: number;
  showLogo: boolean;
  footerNote: string | null;
}): Promise<Result> {
  const { context, error } = await guard();
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurants')
    .update({
      print_settings: {
        paper: input.paper,
        autoPrint: input.autoPrint,
        copies: Math.min(Math.max(input.copies, 1), 5),
        showLogo: input.showLogo,
        footerNote: input.footerNote?.trim() || null,
      },
    })
    .eq('id', context.restaurant.id);

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}
