import { createServerSupabase } from '@/lib/supabase/server';
import type { CouponRow } from '@/components/dashboard/coupons-manager';

/**
 * Cupones visibles para quien consulta, con su alcance resuelto.
 *
 * `restaurantId` null trae los de plataforma (vista del superadministrador);
 * con id, los del local. RLS ya limita lo que cada uno puede leer, pero el
 * filtro explícito evita traer de más.
 */
export async function listCoupons(restaurantId: string | null): Promise<CouponRow[]> {
  const supabase = await createServerSupabase();

  const query = supabase.from('coupons').select('*').order('created_at', { ascending: false });
  const { data: coupons } = restaurantId
    ? await query.eq('restaurant_id', restaurantId)
    : await query.is('restaurant_id', null);

  if (!coupons?.length) return [];

  const ids = coupons.map((coupon) => coupon.id);
  const [{ data: productLinks }, { data: categoryLinks }] = await Promise.all([
    supabase.from('coupon_products').select('coupon_id, product_id').in('coupon_id', ids),
    supabase.from('coupon_categories').select('coupon_id, category_id').in('coupon_id', ids),
  ]);

  return coupons.map((coupon) => ({
    id: coupon.id,
    code: coupon.code,
    kind: coupon.kind,
    percentage: coupon.percentage === null ? null : Number(coupon.percentage),
    valueCents: coupon.value_cents,
    maxDiscountCents: coupon.max_discount_cents,
    target: coupon.target,
    minOrderCents: coupon.min_order_cents,
    startsAt: coupon.starts_at,
    endsAt: coupon.ends_at,
    maxRedemptions: coupon.max_redemptions,
    maxPerCustomer: coupon.max_per_customer,
    redemptionsCount: coupon.redemptions_count,
    isActive: coupon.is_active,
    description: coupon.description,
    isGlobal: coupon.restaurant_id === null,
    productIds: (productLinks ?? [])
      .filter((link) => link.coupon_id === coupon.id)
      .map((link) => link.product_id),
    categoryIds: (categoryLinks ?? [])
      .filter((link) => link.coupon_id === coupon.id)
      .map((link) => link.category_id),
  }));
}
