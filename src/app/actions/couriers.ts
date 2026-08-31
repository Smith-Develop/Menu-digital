'use server';

import { createServerSupabase } from '@/lib/supabase/server';

export type CourierDelivery = {
  id: string;
  code: string;
  totalCents: number;
  address: string | null;
  pickedUpAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

/**
 * Entregas hechas por un repartidor.
 *
 * Sólo devuelve las de los restaurantes que quien pregunta puede ver: las
 * políticas de la tabla ya lo garantizan, así que un local ve el trabajo que ese
 * repartidor hizo para él y el superadministrador lo ve entero.
 */
export async function listCourierDeliveries(
  courierId: string,
  limit = 30,
): Promise<CourierDelivery[]> {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from('orders')
    .select('id, code, total_cents, address, picked_up_at, completed_at, created_at')
    .eq('courier_id', courierId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((order) => ({
    id: order.id,
    code: order.code,
    totalCents: order.total_cents,
    address: order.address,
    pickedUpAt: order.picked_up_at,
    completedAt: order.completed_at,
    createdAt: order.created_at,
  }));
}
