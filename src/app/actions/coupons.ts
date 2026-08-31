'use server';

import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';

export type SavedCoupon = {
  code: string;
  kind: string;
  percentage: number | null;
  value_cents: number | null;
  min_order_cents: number;
  description: string | null;
  ends_at: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  restaurant_slug: string | null;
  used: number;
  max_per_customer: number | null;
};

/**
 * Guarda un cupón en la cuenta de quien lo acaba de canjear.
 *
 * Se llama al validarlo, no al pagar: así queda anotado aunque el pedido se
 * abandone, que es justo cuando conviene tenerlo a mano la próxima vez. Si no
 * hay sesión no se hace nada; el cupón sigue aplicándose al pedido en curso.
 */
export async function rememberCoupon(code: string, restaurantSlug: string): Promise<void> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // La tabla de cupones no es legible por los clientes —para eso la validación
  // es una función con permisos propios—, así que el cupón se localiza con la
  // clave de servicio. La fila que se escribe después es suya y va con su
  // sesión, sujeta a las políticas de siempre.
  let service: ReturnType<typeof createAdminSupabase>;
  try {
    service = createAdminSupabase();
  } catch {
    return;
  }

  const { data: restaurante } = await service
    .from('restaurants')
    .select('id')
    .eq('slug', restaurantSlug)
    .maybeSingle();

  // Un cupón global no tiene restaurante; uno del local sí. El mismo código
  // puede existir en ambos ámbitos, y manda el del restaurante.
  const { data: candidatos } = await service
    .from('coupons')
    .select('id, restaurant_id')
    .eq('code', code.toUpperCase())
    .in('restaurant_id', restaurante?.id ? [restaurante.id] : []);

  const { data: globales } = await service
    .from('coupons')
    .select('id, restaurant_id')
    .eq('code', code.toUpperCase())
    .is('restaurant_id', null);

  const cupon = (candidatos ?? [])[0] ?? (globales ?? [])[0];
  if (!cupon) return;

  await supabase
    .from('customer_coupons')
    .upsert({ user_id: user.id, coupon_id: cupon.id }, { onConflict: 'user_id,coupon_id' });
}

/** Cupones guardados que todavía puede usar. */
export async function listMyCoupons(): Promise<SavedCoupon[]> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase.rpc('my_coupons');
  return (data as unknown as SavedCoupon[] | null) ?? [];
}
