'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isoDateTime } from '@/lib/validation';
import { createServerSupabase, createPublicSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { requireStaffContext } from '@/lib/auth';
import {
  canManageMenu,
  canManageStaff,
  canManageSettings,
  canAccessSection,
  canChargeOrders,
  canCancelOrders,
  canRefund,
  canVoidItems,
  canDiscount,
} from '@/lib/auth-permissions';
import type { Enums } from '@/types/database';
import { tableCode as makeTableCode } from '@/lib/utils';
import { getCurrency } from '@/lib/money';
import { sendMail } from '@/lib/mailer';
import { staffInvitationEmail } from '@/lib/emails/staff-invitation';
import { emailChangedNotice } from '@/lib/emails/account-notices';
import { sendPasswordResetFor } from '@/lib/password-reset';
import { getPublicOrigin } from '@/lib/request-url';
import { getBrand } from '@/lib/brand';
import { getI18n } from '@/i18n';
import { sendOrderPush, sendUserPush } from '@/lib/push';
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
  // Nulo usa el tipo general del restaurante, que es el caso mayoritario.
  tax_rate: z.coerce.number().min(0).max(1).nullable().optional(),
  track_stock: z.boolean().default(false),
  stock_qty: z.coerce.number().int().min(0).default(0),
  low_stock_threshold: z.coerce.number().int().min(0).default(0),
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
  // Texto libre: cada país nombra su documento a su manera.
  document_type: z.string().max(40).nullable().optional(),
  document_number: z.string().max(60).nullable().optional(),
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
  | 'served'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<Result> {
  const context = await requireStaffContext();
  const supabase = await createServerSupabase();

  // Anular tiene su propia acción porque exige motivo y devuelve el cupón.
  // Llegar aquí con 'cancelled' sería saltarse las dos cosas.
  if (status === 'cancelled') return fail('USE_CANCEL_ORDER');

  const { error: dbError } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('restaurant_id', context.restaurant.id);

  // La base rechaza cerrar un pedido que nadie ha cobrado. Se traduce aquí para
  // que el panel pueda ofrecer el cobro en lugar de enseñar un error opaco.
  if (dbError?.message.includes('PAYMENT_REQUIRED')) return fail('PAYMENT_REQUIRED');
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

/**
 * Registra el cobro de una cuenta.
 *
 * Antes esto escribía una palabra en el pedido y nada más: no quedaba ni la
 * hora, ni quién cobró, ni con qué se pagó de verdad. Ahora pasa por una
 * función de la base que sella las tres cosas, y que además comprueba el rol
 * —cocina no toca el dinero—.
 *
 * `method` es el medio realmente empleado, que no tiene por qué ser el que el
 * cliente eligió al pedir: se encarga en efectivo y se paga con tarjeta en la
 * puerta más a menudo de lo que parece. Sin ese dato, ese importe se le seguía
 * reclamando al repartidor.
 */
export async function markOrderPaid(
  orderId: string,
  method?: Enums<'payment_method'>,
): Promise<Result<{ alreadyPaid: boolean }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error: rpcError } = await supabase.rpc('mark_order_paid', {
    p_order_id: orderId,
    p_method: method ?? undefined,
  });

  if (rpcError) return fail(errorCode(rpcError.message));

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { alreadyPaid: Boolean((data as { already?: boolean })?.already) } };
}

/**
 * Anula un pedido dejando constancia del porqué.
 *
 * El motivo es obligatorio: sin él no hay forma de distinguir un cliente que se
 * arrepiente de una cocina saturada, y no queda nada que analizar después. La
 * función de la base devuelve además el cupón, que hasta ahora se quedaba
 * consumido por un pedido que nunca existió.
 */
export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<Result<{ couponFreed: boolean }>> {
  const context = await requireStaffContext();
  if (!canCancelOrders(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('CANCEL_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { data, error: rpcError } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason.trim().slice(0, 300),
  });

  if (rpcError) return fail(errorCode(rpcError.message));

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { couponFreed: Boolean((data as { coupon_freed?: boolean })?.coupon_freed) } };
}

/**
 * Rescata el código de error que lanza la base.
 *
 * Postgres devuelve el mensaje entero, y el panel necesita la palabra suelta
 * para traducirla al idioma del usuario en lugar de enseñar el texto crudo.
 */
function errorCode(message: string): string {
  const known = [
    'FORBIDDEN_CHARGE',
    'FORBIDDEN_CANCEL',
    'FORBIDDEN_SETTLE',
    'CANCEL_REASON_REQUIRED',
    'ALREADY_PAID',
    'ORDER_CANCELLED',
    'ORDER_NOT_FOUND',
    'PAYMENT_REQUIRED',
    'FORBIDDEN_REFUND',
    'FORBIDDEN_VOID',
    'FORBIDDEN_DISCOUNT',
    'REFUND_REASON_REQUIRED',
    'REFUND_EXCEEDS_PAID',
    'NOTHING_TO_REFUND',
    'VOID_REASON_REQUIRED',
    'DISCOUNT_REASON_REQUIRED',
    'DISCOUNT_EXCEEDS_ORDER',
    'FAIL_REASON_REQUIRED',
    'ORDER_NOT_IN_DELIVERY',
    'LAST_ITEM',
    'OVERPAYMENT',
    'INVALID_AMOUNT',
    'FORBIDDEN_CASH',
    'SESSION_ALREADY_OPEN',
    'SESSION_ALREADY_CLOSED',
    'SESSION_NOT_FOUND',
    'NO_OPEN_SESSION',
    'COUNT_REQUIRED',
    'MOVEMENT_REASON_REQUIRED',
    'NOT_PAID',
    'FISCAL_DOCUMENT_IMMUTABLE',
    'DOCUMENT_NOT_FOUND',
    'ALREADY_CREDIT_NOTE',
    'ORDER_CLOSED',
    'TABLE_OTHER_RESTAURANT',
    'TABLE_NOT_FOUND',
    'SAME_TABLE',
    'STOCK_REASON_REQUIRED',
    'INVALID_KIND',
    'INVALID_TRANSITION',
    'ROLE_CANNOT_TRANSITION',
  ];
  return known.find((code) => message.includes(code)) ?? message;
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

// ================================= Sala ==================================

/**
 * Asigna —o retira— el camarero que atiende una mesa.
 *
 * A partir de ese momento los avisos de esa mesa le llegan también a su móvil,
 * además de sonar en la comanda principal.
 */
export async function assignTableWaiter(
  tableId: string,
  waiterId: string | null,
): Promise<Result> {
  const context = await requireStaffContext();
  if (!canAccessSection('floor', context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();

  // El camarero ha de ser del equipo: sin esta comprobación se podría apuntar
  // a cualquier usuario de la plataforma como responsable de una mesa.
  if (waiterId) {
    const { data: miembro } = await supabase
      .from('restaurant_staff')
      .select('id')
      .eq('restaurant_id', context.restaurant.id)
      .eq('user_id', waiterId)
      .maybeSingle();
    if (!miembro) return fail('NOT_IN_TEAM');
  }

  const { error } = await supabase
    .from('tables')
    .update({
      assigned_waiter_id: waiterId,
      assigned_at: waiterId ? new Date().toISOString() : null,
    })
    .eq('id', tableId)
    .eq('restaurant_id', context.restaurant.id);

  if (error) return fail(error.message);

  revalidatePath('/dashboard/floor');
  return { ok: true };
}

/** Da por atendido un aviso de mesa. */
export async function attendCall(callId: string): Promise<Result> {
  const context = await requireStaffContext();
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('waiter_calls')
    .update({ attended_at: new Date().toISOString(), status: 'attended' })
    .eq('id', callId)
    .eq('restaurant_id', context.restaurant.id);

  if (error) return fail(error.message);

  revalidatePath('/dashboard/floor');
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Cierra la sesión de una mesa, o de todas.
 *
 * Renovar el turno invalida al instante la cookie que llevan los móviles que
 * escanearon esa mesa. Normalmente eso ocurre solo al cobrar la cuenta, pero
 * hace falta poder forzarlo: si alguien escaneó y se fue sin pedir, la mesa se
 * queda ocupada por un cliente que ya no está y el siguiente se encuentra con
 * la sesión del anterior.
 *
 * Queda para quien responde del negocio, no para toda la sala: echar por error
 * a una mesa que está pidiendo le borra el carrito.
 */
export async function endTableSession(tableId: string | null): Promise<Result> {
  const context = await requireStaffContext();
  if (!canManageSettings(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const cambios = {
    session_id: crypto.randomUUID(),
    assigned_waiter_id: null,
    assigned_at: null,
  };

  // Una mesa concreta o todas las del restaurante. En el segundo caso cada una
  // necesita su propio turno: compartirlo permitiría saltar de mesa con la
  // cookie de otra.
  if (tableId) {
    const { error } = await supabase
      .from('tables')
      .update(cambios)
      .eq('id', tableId)
      .eq('restaurant_id', context.restaurant.id);
    if (error) return fail(error.message);
  } else {
    const { data: mesas } = await supabase
      .from('tables')
      .select('id')
      .eq('restaurant_id', context.restaurant.id);

    for (const mesa of mesas ?? []) {
      const { error } = await supabase
        .from('tables')
        .update({ ...cambios, session_id: crypto.randomUUID() })
        .eq('id', mesa.id);
      if (error) return fail(error.message);
    }
  }

  revalidatePath('/dashboard/floor');
  return { ok: true };
}

// ============================== Reparto ==============================

/**
 * Asigna el pedido a un repartidor y le avisa al móvil.
 *
 * La asignación pasa por el servidor —y no por la llamada directa a la base de
 * datos— porque avisar es parte del encargo: un repartidor que no se entera de
 * que le han dado un pedido no va a recogerlo.
 */
export async function assignCourier(orderId: string, courierId: string): Promise<Result> {
  const { context, error } = await guard('menu');
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: rpcError } = await supabase.rpc('assign_order_courier', {
    p_order_id: orderId,
    p_courier_id: courierId,
  });

  if (rpcError) return fail(rpcError.message);

  void notifyCourierAssigned(orderId, courierId, context.restaurant.name).catch(() => undefined);

  revalidatePath('/dashboard/orders');
  return { ok: true };
}

async function notifyCourierAssigned(orderId: string, courierId: string, restaurante: string) {
  const service = createAdminSupabase();

  const [{ data: courier }, { data: order }] = await Promise.all([
    service.from('couriers').select('user_id').eq('id', courierId).maybeSingle(),
    service.from('orders').select('code, address').eq('id', orderId).maybeSingle(),
  ]);

  if (!courier?.user_id) return;

  const { t } = await getI18n();
  await sendUserPush(courier.user_id, {
    title: t.push.pickupTitle.replace('{restaurant}', restaurante),
    body: t.push.pickupBody.replace('{code}', order?.code ?? ''),
    url: '/courier',
    tag: `reparto-${orderId}`,
  });
}

/** El restaurante entrega el pedido al repartidor, que sale con él. */
export async function markPickedUp(orderId: string): Promise<Result> {
  const { context, error } = await guard('menu');
  if (!context) return fail(error);

  const supabase = await createServerSupabase();
  const { error: rpcError } = await supabase.rpc('courier_picked_up', { p_order_id: orderId });
  if (rpcError) return fail(rpcError.message);

  // El cliente ve que su pedido ha salido; el aviso lo manda el mismo camino
  // que el resto de cambios de estado.
  await notifyOrderStatus(orderId, 'delivering', context.restaurant.name);

  revalidatePath('/dashboard/orders');
  return { ok: true };
}

/** El restaurante da por recibido el efectivo que traía un repartidor. */
export async function settleCourierCash(
  courierId: string,
): Promise<Result<{ orders: number; cents: number }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  // El local va explícito. La función lo resolvía tomando la primera fila de
  // equipo del usuario con un `limit 1` sin ordenar, así que quien trabaja en
  // dos locales de la plataforma liquidaba en el que devolviera la base
  // primero: el dinero se daba por recibido en la caja equivocada.
  const { data, error: rpcError } = await supabase.rpc('settle_courier_cash', {
    p_courier_id: courierId,
    p_restaurant_id: context.restaurant.id,
  });
  if (rpcError) return fail(errorCode(rpcError.message));

  const result = data as { orders?: number; cents?: number } | null;
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { orders: result?.orders ?? 0, cents: result?.cents ?? 0 } };
}

// ===================== Cobros, devoluciones y ajustes =====================
//
// Todo lo de aquí abajo es la fase 1 de la auditoría: el dinero deja de ser una
// columna del pedido y pasa a ser un libro de apuntes. Ninguna de estas
// acciones escribe en `orders` directamente; todas pasan por funciones de la
// base que comprueban el permiso y recalculan el saldo.

/**
 * Añade un cobro a una cuenta.
 *
 * Sin importe cobra lo que falte, que es el caso normal. Con importe cobra una
 * parte: es lo que permite dividir la cuenta entre comensales o pagar la mitad
 * en efectivo y la otra mitad con tarjeta.
 */
export async function addOrderPayment(
  orderId: string,
  method: Enums<'payment_method'>,
  amountCents?: number | null,
  note?: string | null,
): Promise<Result<{ paidCents: number; dueCents: number; fullyPaid: boolean }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('add_order_payment', {
    p_order_id: orderId,
    p_method: method,
    p_amount_cents: amountCents ?? null,
    p_note: note ?? null,
  });

  if (error) return fail(errorCode(error.message));

  const r = data as { paid_cents?: number; due_cents?: number; fully_paid?: boolean } | null;
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return {
    ok: true,
    data: {
      paidCents: r?.paid_cents ?? 0,
      dueCents: r?.due_cents ?? 0,
      fullyPaid: Boolean(r?.fully_paid),
    },
  };
}

/** Cobra de una vez todo lo que debe una mesa, repartiéndolo entre sus comandas. */
export async function payTableBill(
  tableId: string,
  method: Enums<'payment_method'>,
  amountCents?: number | null,
  note?: string | null,
): Promise<Result<{ orders: number; chargedCents: number; dueCents: number }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('pay_table_bill', {
    p_table_id: tableId,
    p_method: method,
    p_amount_cents: amountCents ?? null,
    p_note: note ?? null,
  });

  if (error) return fail(errorCode(error.message));

  const r = data as { orders?: number; charged_cents?: number; due_cents?: number } | null;
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/floor');
  revalidatePath('/dashboard/orders');
  return {
    ok: true,
    data: {
      orders: r?.orders ?? 0,
      chargedCents: r?.charged_cents ?? 0,
      dueCents: r?.due_cents ?? 0,
    },
  };
}

/**
 * Devuelve dinero de una cuenta ya cobrada.
 *
 * Nunca toca el cobro original: añade un apunte negativo enlazado a la misma
 * venta, que es lo que permite que lo que entró y lo que salió sigan siendo
 * ciertos a la vez. Sin importe devuelve todo lo cobrado.
 */
export async function refundOrder(
  orderId: string,
  reason: string,
  amountCents?: number | null,
  method?: Enums<'payment_method'>,
): Promise<Result<{ refundedCents: number; paidCents: number }>> {
  const context = await requireStaffContext();
  if (!canRefund(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('REFUND_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('refund_order', {
    p_order_id: orderId,
    p_reason: reason.trim().slice(0, 300),
    p_amount_cents: amountCents ?? null,
    p_method: method ?? undefined,
  });

  if (error) return fail(errorCode(error.message));

  const r = data as { refunded_cents?: number; paid_cents?: number } | null;
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { refundedCents: r?.refunded_cents ?? 0, paidCents: r?.paid_cents ?? 0 } };
}

/** Quita una línea de una comanda ya enviada, dejando dicho por qué. */
export async function voidOrderItem(
  itemId: string,
  reason: string,
): Promise<Result<{ totalCents: number }>> {
  const context = await requireStaffContext();
  if (!canVoidItems(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('VOID_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('void_order_item', {
    p_item_id: itemId,
    p_reason: reason.trim().slice(0, 300),
  });

  if (error) return fail(errorCode(error.message));

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { totalCents: (data as { total_cents?: number })?.total_cents ?? 0 } };
}

/** Descuento de la casa: la invitación, el plato que salió mal, la compensación. */
export async function applyManualDiscount(
  orderId: string,
  cents: number,
  reason: string,
): Promise<Result<{ totalCents: number }>> {
  const context = await requireStaffContext();
  if (!canDiscount(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('DISCOUNT_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('apply_manual_discount', {
    p_order_id: orderId,
    p_cents: Math.max(0, Math.round(cents)),
    p_reason: reason.trim().slice(0, 300),
  });

  if (error) return fail(errorCode(error.message));

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { totalCents: (data as { total_cents?: number })?.total_cents ?? 0 } };
}

/**
 * Entrega fallida: la comida vuelve al local.
 *
 * El pedido regresa a "listo" y se suelta al repartidor. Desde ahí decide el
 * restaurante —reintentar con otro, o anular—, que es una decisión suya y no
 * del repartidor parado en un portal.
 */
export async function failDelivery(orderId: string, reason: string): Promise<Result> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('FAIL_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('courier_fail_delivery', {
    p_order_id: orderId,
    p_reason: reason.trim().slice(0, 300),
  });

  if (error) return fail(errorCode(error.message));
  revalidatePath('/dashboard/orders');
  return { ok: true };
}

// ============================== Caja y turno ==============================
//
// Fase 2 de la auditoría. Sin apertura con fondo, cierre con recuento y
// descuadre, un panel de pedidos no llega a ser un TPV: nunca compara lo que
// dice el sistema con el dinero que hay de verdad en el cajón.

/** Abre el turno declarando el fondo con el que se empieza. */
export async function openCashSession(
  floatCents: number,
  note?: string | null,
): Promise<Result<{ sessionId: string }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('open_cash_session', {
    p_restaurant_id: context.restaurant.id,
    p_float_cents: Math.max(0, Math.round(floatCents)),
    p_note: note?.trim() || null,
  });

  if (error) return fail(errorCode(error.message));
  revalidatePath('/dashboard/cash');
  return { ok: true, data: { sessionId: (data as { session_id: string }).session_id } };
}

/** Cierra el turno con el recuento a mano y deja el descuadre a la vista. */
export async function closeCashSession(
  sessionId: string,
  countedCents: number,
  note?: string | null,
): Promise<Result<{ expectedCents: number; countedCents: number; varianceCents: number }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('close_cash_session', {
    p_session_id: sessionId,
    p_counted_cents: Math.max(0, Math.round(countedCents)),
    p_note: note?.trim() || null,
  });

  if (error) return fail(errorCode(error.message));

  const r = data as { expected_cents: number; counted_cents: number; variance_cents: number };
  revalidatePath('/dashboard/cash');
  revalidatePath('/dashboard');
  return {
    ok: true,
    data: {
      expectedCents: r.expected_cents,
      countedCents: r.counted_cents,
      varianceCents: r.variance_cents,
    },
  };
}

/** Entrada o salida de efectivo que no es una venta. */
export async function addCashMovement(
  kind: Enums<'cash_movement_kind'>,
  amountCents: number,
  reason: string,
): Promise<Result> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('MOVEMENT_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('add_cash_movement', {
    p_restaurant_id: context.restaurant.id,
    p_kind: kind,
    p_amount_cents: Math.round(amountCents),
    p_reason: reason.trim().slice(0, 200),
  });

  if (error) return fail(errorCode(error.message));
  revalidatePath('/dashboard/cash');
  return { ok: true };
}

// ========================= Documentos fiscales =========================
//
// Fase 3. Lo que se imprimía no podía defenderse ante una inspección: sin serie
// ni numeración correlativa, sin identificación fiscal del emisor y sin
// desglose por tipo impositivo. El documento se congela al emitirse, de modo
// que tocar el pedido después no reescribe una factura ya entregada.

/**
 * Emite el documento de una venta.
 *
 * Con datos fiscales del cliente sale factura; sin ellos, ticket simplificado.
 * Emitir dos veces no duplica la numeración: devuelve el que ya existe.
 */
export async function issueFiscalDocument(
  orderId: string,
  customer?: { name?: string | null; taxId?: string | null; address?: string | null },
): Promise<Result<{ id: string; fullNumber: string; kind: string; already: boolean }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('issue_fiscal_document', {
    p_order_id: orderId,
    p_customer_name: customer?.name?.trim() || null,
    p_customer_tax_id: customer?.taxId?.trim() || null,
    p_customer_address: customer?.address?.trim() || null,
  });

  if (error) return fail(errorCode(error.message));

  const r = data as { id: string; full_number: string; kind?: string; already?: boolean };
  revalidatePath('/dashboard/orders');
  return {
    ok: true,
    data: {
      id: r.id,
      fullNumber: r.full_number,
      kind: r.kind ?? 'simplified',
      already: Boolean(r.already),
    },
  };
}

/**
 * Emite una rectificativa sobre un documento ya entregado.
 *
 * Es la contrapartida fiscal de la devolución: nunca toca el original, emite
 * otro que lo enmienda.
 */
export async function issueCreditNote(
  documentId: string,
  reason: string,
  amountCents?: number | null,
): Promise<Result<{ fullNumber: string; totalCents: number }>> {
  const context = await requireStaffContext();
  if (!canRefund(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('REFUND_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('issue_credit_note', {
    p_document_id: documentId,
    p_reason: reason.trim().slice(0, 300),
    p_amount_cents: amountCents ?? null,
  });

  if (error) return fail(errorCode(error.message));

  const r = data as { full_number: string; total_cents: number };
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { fullNumber: r.full_number, totalCents: r.total_cents } };
}

// ============================ Sala: mesas ============================

/** Mueve una comanda a otra mesa. */
export async function transferOrderToTable(orderId: string, tableId: string): Promise<Result> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('transfer_order_to_table', {
    p_order_id: orderId,
    p_table_id: tableId,
  });

  if (error) return fail(errorCode(error.message));
  revalidatePath('/dashboard/orders');
  return { ok: true };
}

/** Junta dos mesas: lo abierto de la primera pasa a la segunda. */
export async function mergeTables(
  fromTableId: string,
  toTableId: string,
): Promise<Result<{ orders: number }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('merge_tables', {
    p_from_table: fromTableId,
    p_to_table: toTableId,
  });

  if (error) return fail(errorCode(error.message));
  revalidatePath('/dashboard/orders');
  return { ok: true, data: { orders: (data as { orders?: number })?.orders ?? 0 } };
}

// ============================ Existencias ============================

/** Recuento, merma o reposición. El motivo es obligatorio. */
export async function adjustStock(
  productId: string,
  kind: Enums<'stock_movement_kind'>,
  qty: number,
  reason: string,
): Promise<Result<{ stock: number }>> {
  const context = await requireStaffContext();
  if (!canManageMenu(context.staffRole)) return fail('FORBIDDEN');
  if (!reason.trim()) return fail('STOCK_REASON_REQUIRED');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_product_id: productId,
    p_kind: kind,
    p_qty: Math.round(qty),
    p_reason: reason.trim().slice(0, 200),
  });

  if (error) return fail(errorCode(error.message));
  revalidatePath('/dashboard/menu');
  return { ok: true, data: { stock: (data as { stock?: number })?.stock ?? 0 } };
}

// ======================== Pedido desde la caja ========================

/**
 * Toma un pedido en el mostrador o por teléfono.
 *
 * Existe para no obligar a quien coge el teléfono a abrir la tienda del
 * cliente, buscar los platos como si fuera un comensal y rellenar un pago que
 * no le corresponde. Pasa por la misma función que el pedido del cliente —los
 * precios, el cupón y las existencias se comprueban igual—, pero el turno de
 * mesa no hace falta: quien lo levanta es del equipo del local.
 *
 * Si se indica el medio de pago, el cobro se registra en el acto: en el
 * mostrador se paga al pedir, y obligar a ir después al panel de pedidos para
 * marcarlo sería un paso de más en la operación más frecuente del día.
 */
export async function createCounterOrder(input: {
  items: { product_id: string; quantity: number; option_ids?: string[]; notes?: string | null }[];
  type: Enums<'order_type'>;
  paymentMethod: Enums<'payment_method'>;
  tableCode?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  address?: string | null;
  addressNotes?: string | null;
  notes?: string | null;
  covers?: number | null;
  couponCode?: string | null;
  tipCents?: number;
  /** Cobrar en el acto. Falso deja la cuenta abierta, como una mesa. */
  chargeNow?: boolean;
}): Promise<Result<{ id: string; code: string; totalCents: number; charged: boolean }>> {
  const context = await requireStaffContext();
  if (!canChargeOrders(context.staffRole)) return fail('FORBIDDEN');
  if (input.items.length === 0) return fail('EMPTY_CART');

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('place_order', {
    p_restaurant_slug: context.restaurant.slug,
    p_items: input.items,
    p_type: input.type,
    p_payment_method: input.paymentMethod,
    p_table_code: input.tableCode ?? null,
    p_customer_name: input.customerName?.trim() || null,
    p_customer_phone: input.customerPhone?.trim() || null,
    p_address: input.address?.trim() || null,
    p_address_notes: input.addressNotes?.trim() || null,
    p_notes: input.notes?.trim() || null,
    p_tip_cents: Math.max(0, Math.round(input.tipCents ?? 0)),
    p_coupon_code: input.couponCode?.trim() || null,
    p_covers: input.covers ?? null,
  });

  if (error) return fail(errorCode(error.message));

  const order = data as { id: string; code: string; total_cents: number };

  let charged = false;
  if (input.chargeNow) {
    const { error: payError } = await supabase.rpc('add_order_payment', {
      p_order_id: order.id,
      p_method: input.paymentMethod,
      p_amount_cents: null,
      p_note: null,
    });
    // Si el cobro falla el pedido ya existe y no se pierde: se queda pendiente
    // y se cobra desde el panel. Decírselo es mejor que deshacer una comanda
    // que la cocina puede tener ya delante.
    charged = !payError;
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/orders');
  return {
    ok: true,
    data: { id: order.id, code: order.code, totalCents: order.total_cents, charged },
  };
}
