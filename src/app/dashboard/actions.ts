'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isoDateTime } from '@/lib/validation';
import { createServerSupabase, createPublicSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { requireStaffContext } from '@/lib/auth';
import { canManageMenu, canManageStaff, canManageSettings } from '@/lib/auth-permissions';
import { tableCode as makeTableCode } from '@/lib/utils';
import { getCurrency } from '@/lib/money';
import { sendMail } from '@/lib/mailer';
import { staffInvitationEmail } from '@/lib/emails/staff-invitation';
import { emailChangedNotice } from '@/lib/emails/account-notices';
import { sendPasswordResetFor } from '@/lib/password-reset';
import { getPublicOrigin } from '@/lib/request-url';
import { getBrand } from '@/lib/brand';
import { getI18n } from '@/i18n';
import { sendOrderPush } from '@/lib/push';
import { orderPushMessage } from '@/lib/push-messages';

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Comprueba sesión + permiso y devuelve el restaurante del usuario. */
async function guard(kind: 'menu' | 'staff' | 'settings' = 'menu') {
  const context = await requireStaffContext();
  const allowed =
    kind === 'staff'
      ? canManageStaff(context.staffRole)
      : kind === 'settings'
        ? canManageSettings(context.staffRole)
        : canManageMenu(context.staffRole);
  if (!allowed) return { context: null, error: 'FORBIDDEN' as const };
  return { context, error: null };
}

// =============================== Platos =================================

const productSchema = z.object({
  id: z.string().uuid().optional(),
  // La categoría sale del catálogo que mantiene la plataforma, no del propio
  // restaurante: es lo que permite agrupar platos de locales distintos.
  catalog_category_id: z.string().uuid().nullable().optional(),
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
  const { context, error } = await guard('settings');
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

type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<Result> {
  const context = await requireStaffContext();
  const supabase = await createServerSupabase();

  const { error: dbError } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('restaurant_id', context.restaurant.id);

  if (dbError) return fail(dbError.message);

  // Aviso al móvil del cliente. Se espera —tarda unos cientos de milisegundos—
  // en vez de dejarlo suelto: una promesa lanzada sin await puede quedarse a
  // medias cuando la petición termina. El error se traga, eso sí: que un push
  // no salga no puede impedir que la cocina avance el pedido.
  await notifyOrderStatus(orderId, status, context.restaurant.name);

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true };
}

async function notifyOrderStatus(orderId: string, status: OrderStatus, restaurantName: string) {
  try {
    // Cliente de servicio, no el de la sesión: éste no depende de las cookies
    // de la petición, que ya podrían no estar disponibles al enviar el aviso.
    const { data: order } = await createAdminSupabase()
      .from('orders')
      .select('code, public_token')
      .eq('id', orderId)
      .maybeSingle();

    const { t } = await getI18n();
    const message = orderPushMessage(status, t, restaurantName, order?.code ?? '');
    if (!message) return;

    await sendOrderPush(orderId, {
      ...message,
      url: order?.public_token ? `/order/${order.public_token}` : '/orders',
      tag: `order-${orderId}`,
    });
  } catch (error) {
    // El aviso es accesorio y nunca corta el flujo, pero se deja rastro: si los
    // clientes dejan de recibir avisos, sin esto no hay forma de saber por qué.
    console.error('[push] no se pudo avisar del cambio de estado', error);
  }
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
  starts_at: isoDateTime().nullable().optional(),
  ends_at: isoDateTime().nullable().optional(),
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
  const { context, error } = await guard('settings');
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
  const { context, error } = await guard('settings');
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

/**
 * Alta directa de un miembro del equipo.
 *
 * El restaurante crea la cuenta y entrega la contraseña en mano, sin esperar a
 * que la persona acepte una invitación. Se usa el registro normal de Supabase
 * con un cliente sin sesión: crear usuarios con la clave de administración
 * exigiría tener esa clave en el servidor de la aplicación, y no hace falta
 * para esto.
 *
 * Si la instancia exige confirmar el correo, la cuenta queda creada pero el
 * empleado tendrá que confirmarla antes de poder entrar; el panel lo avisa.
 */
export async function createStaffAccount(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  role: 'admin' | 'manager' | 'waiter' | 'kitchen' | 'cashier';
  asCourier?: boolean;
}): Promise<Result<{ needsConfirmation: boolean }>> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) return fail('INVALID_EMAIL');
  if (input.password.length < 8) return fail('PASSWORD_TOO_SHORT');

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

  // Si ya tiene perfil, basta con vincularlo: no se le toca la contraseña.
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let userId = existing?.id ?? null;
  let needsConfirmation = false;

  if (!userId) {
    // Cliente aparte, sin persistir sesión: registrar a otro no debe cambiar
    // la sesión del dueño que está usando el panel.
    const anon = createPublicSupabase();
    const { data, error: signUpError } = await anon.auth.signUp({
      email,
      password: input.password,
      options: { data: { full_name: input.fullName.trim(), role: 'restaurant' } },
    });

    if (signUpError || !data.user) {
      return fail(signUpError?.message ?? 'SIGNUP_FAILED');
    }

    userId = data.user.id;
    needsConfirmation = !data.session;
  }

  const { error: linkError } = await supabase
    .from('restaurant_staff')
    .upsert(
      { restaurant_id: context.restaurant.id, user_id: userId, role: input.role, is_active: true },
      { onConflict: 'restaurant_id,user_id' },
    );

  if (linkError) return fail(linkError.message);

  if (input.asCourier) {
    const { data: courier } = await supabase
      .from('couriers')
      .upsert({ user_id: userId, phone: input.phone?.trim() || null }, { onConflict: 'user_id' })
      .select('id')
      .maybeSingle();

    if (courier) {
      await supabase
        .from('restaurant_couriers')
        .upsert(
          { restaurant_id: context.restaurant.id, courier_id: courier.id, is_active: true },
          { onConflict: 'restaurant_id,courier_id' },
        );
    }
  }

  revalidatePath('/dashboard/staff');
  return { ok: true, data: { needsConfirmation } };
}

/** Avisos sonoros del restaurante. `null` vuelve a los de la plataforma. */
export async function updateSoundSettings(value: unknown): Promise<Result> {
  const { context, error } = await guard('settings');
  if (!context) return fail(error);

  const schema = z
    .object({
      newOrder: z.enum(['bell', 'chime', 'ding', 'alert', 'soft', 'none']),
      orderReady: z.enum(['bell', 'chime', 'ding', 'alert', 'soft', 'none']),
      waiterCall: z.enum(['bell', 'chime', 'ding', 'alert', 'soft', 'none']).default('alert'),
      volume: z.coerce.number().min(0).max(1),
      enabled: z.boolean(),
    })
    .nullable();

  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail('INVALID_INPUT');

  const supabase = await createServerSupabase();
  const { error: dbError } = await supabase
    .from('restaurants')
    .update({ sound_settings: parsed.data })
    .eq('id', context.restaurant.id);

  if (dbError) return fail(dbError.message);

  revalidatePath('/dashboard/settings');
  revalidatePath('/kitchen');
  return { ok: true };
}

/**
 * Comprueba que la persona indicada trabaja en el restaurante de quien llama.
 * Sin esto, quien gestiona un equipo podría tocar la cuenta de cualquier
 * usuario de la plataforma pasando otro id.
 */
async function staffMemberOf(restaurantId: string, userId: string) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('restaurant_staff')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/** Envía al empleado un enlace para que se ponga una contraseña nueva. */
export async function sendStaffPasswordReset(userId: string): Promise<Result> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);
  if (!(await staffMemberOf(context.restaurant.id, userId))) return fail('NOT_FOUND');

  const supabase = await createServerSupabase();
  const { data: person } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  if (!person?.email) return fail('NOT_FOUND');
  const result = await sendPasswordResetFor(person.email);
  return result.ok ? { ok: true } : fail(result.error ?? 'MAIL_FAILED');
}

/**
 * Actualiza los datos de un empleado. Si cambia el correo, se avisa a las dos
 * direcciones: a la anterior, porque es la única forma de que su titular se
 * entere de que le han movido el acceso, y a la nueva, para que sepa con qué
 * cuenta entra a partir de ahora.
 */
export async function updateStaffMember(
  userId: string,
  input: { fullName: string; email: string; phone?: string | null },
): Promise<Result> {
  const { context, error } = await guard('staff');
  if (!context) return fail(error);
  if (!(await staffMemberOf(context.restaurant.id, userId))) return fail('NOT_FOUND');

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName) return fail('NAME_REQUIRED');
  if (!email.includes('@')) return fail('INVALID_EMAIL');

  const supabase = await createServerSupabase();
  const { data: current } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle();

  const previousEmail = current?.email ?? null;
  const emailChanged = previousEmail !== email;

  // El perfil se escribe con el cliente de servicio: la política de `profiles`
  // sólo deja a cada cual editar su propia fila, y un UPDATE que RLS descarta
  // no devuelve error, simplemente no toca nada. Con el cliente del dueño el
  // correo cambiaría en auth y no en el perfil, dejando la cuenta descuadrada.
  let service: ReturnType<typeof createAdminSupabase>;
  try {
    service = createAdminSupabase();
  } catch {
    return fail('SERVICE_ROLE_MISSING');
  }

  if (emailChanged) {
    const { error: authError } = await service.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (authError) {
      return fail(/exists|registered/i.test(authError.message) ? 'EMAIL_TAKEN' : authError.message);
    }
  }

  const { data: updated, error: profileError } = await service
    .from('profiles')
    .update({
      full_name: fullName,
      email,
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
    })
    .eq('id', userId)
    .select('id');

  if (profileError) return fail(profileError.message);
  if (!updated?.length) return fail('NOT_FOUND');

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

  revalidatePath('/dashboard/staff');
  return { ok: true };
}
