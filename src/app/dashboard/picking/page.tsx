import { notFound } from 'next/navigation';
import { requireStaffContext } from '@/lib/auth';
import { canAccessSection } from '@/lib/auth-permissions';
import { hasModule } from '@/lib/business-modules';
import { createServerSupabase } from '@/lib/supabase/server';
import { PickingView, type PickingOrder } from '@/components/dashboard/picking-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preparación' };

export default async function PickingPage() {
  const { restaurant, staffRole } = await requireStaffContext();

  // Dos puertas: el rol y el tipo de negocio. Un restaurante no prepara por
  // pasillos, y la URL no debe ser una rendija.
  if (!canAccessSection('picking', staffRole) || !hasModule(restaurant.business_type, 'picking')) {
    notFound();
  }

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('orders')
    .select(
      'id, code, type, status, customer_name, total_cents, currency, created_at, scheduled_for',
    )
    .eq('restaurant_id', restaurant.id)
    .in('status', ['pending', 'confirmed', 'preparing'])
    // Lo que tiene hora de entrega va primero por esa hora; lo demás, por
    // antigüedad. Quien prepara no elige el orden, lo sigue.
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  // Cuántas líneas tiene cada pedido, en una consulta aparte: los tipos
  // generados no llevan las relaciones y el anidado no se puede inferir.
  const ids = (data ?? []).map((o) => o.id);
  const { data: lineas } = ids.length
    ? await supabase.from('order_items').select('order_id').in('order_id', ids)
    : { data: [] };

  const cuantas = new Map<string, number>();
  for (const l of lineas ?? []) cuantas.set(l.order_id, (cuantas.get(l.order_id) ?? 0) + 1);

  const orders: PickingOrder[] = (data ?? []).map((o) => ({
    id: o.id,
    code: o.code,
    type: o.type,
    status: o.status,
    customerName: o.customer_name,
    totalCents: o.total_cents,
    currency: o.currency,
    createdAt: o.created_at,
    scheduledFor: o.scheduled_for,
    lines: cuantas.get(o.id) ?? 0,
  }));

  return <PickingView restaurantId={restaurant.id} orders={orders} />;
}
