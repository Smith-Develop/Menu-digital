import { redirect } from 'next/navigation';
import { requireProfile, getStaffContext } from '@/lib/auth';
import { canWorkKitchen } from '@/lib/auth-permissions';
import { createServerSupabase } from '@/lib/supabase/server';
import { KitchenDisplay, type KitchenTicket } from '@/components/kitchen/kitchen-display';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cocina' };

export default async function KitchenPage() {
  await requireProfile('/kitchen');
  const context = await getStaffContext();
  if (!context) redirect('/onboarding');
  if (!canWorkKitchen(context.staffRole)) redirect('/dashboard');

  const supabase = await createServerSupabase();

  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', context.restaurant.id)
    .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
    .order('created_at', { ascending: true })
    .limit(60);

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('*').in('order_id', orderIds)
    : { data: [] };

  const tableIds = [...new Set((orders ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
  const { data: tables } = tableIds.length
    ? await supabase.from('tables').select('id, name').in('id', tableIds)
    : { data: [] };
  const tableNames = new Map((tables ?? []).map((tb) => [tb.id, tb.name]));

  const tickets: KitchenTicket[] = (orders ?? []).map((order) => ({
    id: order.id,
    code: order.code,
    type: order.type,
    status: order.status,
    tableName: order.table_id ? (tableNames.get(order.table_id) ?? null) : null,
    notes: order.notes,
    createdAt: order.created_at,
    items: (items ?? [])
      .filter((i) => i.order_id === order.id)
      .map((i) => ({
        id: i.id,
        name: i.name_snapshot,
        quantity: i.quantity,
        options: Array.isArray(i.options) ? (i.options as { name: string }[]).map((o) => o.name) : [],
        notes: i.notes,
        status: i.status,
      })),
  }));

  return (
    <KitchenDisplay
      restaurantId={context.restaurant.id}
      restaurantName={context.restaurant.name}
      initialTickets={tickets}
    />
  );
}
