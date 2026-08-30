'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isoDateTime } from '@/lib/validation';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireStaffContext, getSessionProfile } from '@/lib/auth';
import { canManageMenu } from '@/lib/auth-permissions';

export type Result = { ok: true } | { ok: false; error: string };

const couponSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(['percentage', 'fixed', 'free_delivery']),
  percentage: z.coerce.number().min(0.01).max(100).nullable().optional(),
  value_cents: z.coerce.number().int().min(1).nullable().optional(),
  max_discount_cents: z.coerce.number().int().min(1).nullable().optional(),
  target: z.enum(['order', 'products', 'categories']),
  min_order_cents: z.coerce.number().int().min(0).default(0),
  starts_at: isoDateTime().optional(),
  ends_at: isoDateTime().nullable().optional(),
  max_redemptions: z.coerce.number().int().min(1).nullable().optional(),
  max_per_customer: z.coerce.number().int().min(1).default(1),
  is_active: z.boolean().default(true),
  description: z.string().max(200).nullable().optional(),
  product_ids: z.array(z.string().uuid()).default([]),
  category_ids: z.array(z.string().uuid()).default([]),
});

/** Comprueba la coherencia entre el tipo de cupón y su alcance. */
function validateShape(data: z.infer<typeof couponSchema>): string | null {
  if (data.kind === 'percentage' && !data.percentage) return 'PERCENTAGE_REQUIRED';
  if (data.kind === 'fixed' && !data.value_cents) return 'VALUE_REQUIRED';
  if (data.target === 'products' && data.product_ids.length === 0) return 'SCOPE_REQUIRED';
  if (data.target === 'categories' && data.category_ids.length === 0) return 'SCOPE_REQUIRED';
  // Un envío gratis se descuenta del envío, no de unos platos concretos.
  if (data.kind === 'free_delivery' && data.target !== 'order') return 'FREE_DELIVERY_ORDER_ONLY';
  return null;
}

/**
 * Guarda un cupón.
 *
 * `asGlobal` lo convierte en cupón de plataforma (restaurant_id nulo), y eso
 * solo puede hacerlo el superadministrador: un restaurante nunca crea
 * descuentos que se gasten en el local de al lado.
 */
export async function saveCoupon(input: unknown, asGlobal = false): Promise<Result> {
  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const shapeError = validateShape(parsed.data);
  if (shapeError) return { ok: false, error: shapeError };

  const supabase = await createServerSupabase();
  let restaurantId: string | null = null;

  if (asGlobal) {
    const profile = await getSessionProfile();
    if (!profile || profile.role !== 'superadmin') return { ok: false, error: 'FORBIDDEN' };
  } else {
    const context = await requireStaffContext();
    if (!canManageMenu(context.staffRole)) return { ok: false, error: 'FORBIDDEN' };
    restaurantId = context.restaurant.id;
  }

  const { id, product_ids, category_ids, ...values } = parsed.data;

  const payload = {
    ...values,
    code: values.code.toUpperCase(),
    percentage: values.kind === 'percentage' ? values.percentage : null,
    value_cents: values.kind === 'fixed' ? values.value_cents : null,
  };

  const { data: saved, error } = id
    ? await supabase.from('coupons').update(payload).eq('id', id).select('id').maybeSingle()
    : await supabase
        .from('coupons')
        .insert({ ...payload, restaurant_id: restaurantId })
        .select('id')
        .maybeSingle();

  if (error || !saved) {
    // 23505 es la violación del índice único del código.
    return {
      ok: false,
      error: error?.code === '23505' ? 'CODE_TAKEN' : (error?.message ?? 'NOT_SAVED'),
    };
  }

  // El alcance se reemplaza entero: es más simple y no deja huérfanos.
  await supabase.from('coupon_products').delete().eq('coupon_id', saved.id);
  await supabase.from('coupon_categories').delete().eq('coupon_id', saved.id);

  if (parsed.data.target === 'products' && product_ids.length > 0) {
    await supabase
      .from('coupon_products')
      .insert(product_ids.map((productId) => ({ coupon_id: saved.id, product_id: productId })));
  }
  if (parsed.data.target === 'categories' && category_ids.length > 0) {
    await supabase
      .from('coupon_categories')
      .insert(category_ids.map((categoryId) => ({ coupon_id: saved.id, category_id: categoryId })));
  }

  revalidatePath(asGlobal ? '/admin/coupons' : '/dashboard/coupons');
  return { ok: true };
}

export async function deleteCoupon(id: string, asGlobal = false): Promise<Result> {
  const supabase = await createServerSupabase();

  if (asGlobal) {
    const profile = await getSessionProfile();
    if (!profile || profile.role !== 'superadmin') return { ok: false, error: 'FORBIDDEN' };
  } else {
    const context = await requireStaffContext();
    if (!canManageMenu(context.staffRole)) return { ok: false, error: 'FORBIDDEN' };
  }

  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(asGlobal ? '/admin/coupons' : '/dashboard/coupons');
  return { ok: true };
}
