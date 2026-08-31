'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { sendOrderPush } from '@/lib/push';
import { getI18n } from '@/i18n';

export type DeliveryResult = { ok: true; cashCents: number } | { ok: false; error: string };

/**
 * El repartidor entrega el pedido.
 *
 * Si se paga en efectivo, entregar es cobrar: el dinero cambia de manos en la
 * puerta, y ese importe queda pendiente de liquidar con el restaurante. Si el
 * pedido ya venía pagado, sólo se marca la entrega.
 */
export async function deliverOrder(orderId: string): Promise<DeliveryResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('courier_deliver_order', { p_order_id: orderId });

  if (error) return { ok: false, error: error.message };

  const resultado = data as unknown as { cash_cents?: number } | null;

  // Al cliente se le avisa de que ya lo tiene, como en el resto de pasos.
  void avisarEntrega(orderId).catch(() => undefined);

  revalidatePath('/courier');
  return { ok: true, cashCents: resultado?.cash_cents ?? 0 };
}

async function avisarEntrega(orderId: string) {
  const service = createAdminSupabase();
  const { data: order } = await service
    .from('orders')
    .select('public_token')
    .eq('id', orderId)
    .maybeSingle();

  const { t } = await getI18n();
  await sendOrderPush(orderId, {
    title: t.push.completedTitle,
    body: t.push.completedBody,
    url: order?.public_token ? `/order/${order.public_token}` : '/orders',
    tag: `order-${orderId}`,
  });
}

export type CashDue = {
  restaurant_id: string;
  restaurant_name: string;
  orders: number;
  cents: number;
};

/** Efectivo que el repartidor lleva encima y aún no ha entregado. */
export async function listCashDue(): Promise<CashDue[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc('courier_cash_due', {});
  return (data as unknown as CashDue[] | null) ?? [];
}
