import type { Tables } from '@/types/database';
import type { OrderRow } from '@/components/dashboard/live-orders-panel';

/**
 * Traduce las filas crudas de la base a lo que pinta el panel.
 *
 * Vive aquí porque lo necesitan el resumen, la pantalla de pedidos y el propio
 * panel cuando relee un pedido tras un evento de Realtime: mantenerlo en un
 * solo sitio evita que las tres versiones se separen.
 */
export function mapOrderRow(
  order: Tables<'orders'>,
  items: Tables<'order_items'>[],
  tableName: string | null,
): OrderRow {
  return {
    id: order.id,
    code: order.code,
    type: order.type,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    totalCents: order.total_cents,
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    couponCode: order.coupon_code,
    deliveryFeeCents: order.delivery_fee_cents,
    taxCents: order.tax_cents,
    tipCents: order.tip_cents,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    address: order.address,
    addressNotes: order.address_notes,
    tableName,
    notes: order.notes,
    createdAt: order.created_at,
    items: items
      .filter((item) => item.order_id === order.id)
      .map((item) => ({
        id: item.id,
        name: item.name_snapshot,
        quantity: item.quantity,
        lineTotalCents: item.line_total_cents,
        options: Array.isArray(item.options)
          ? (item.options as { name: string }[]).map((option) => option.name)
          : [],
        notes: item.notes,
        status: item.status,
      })),
  };
}
