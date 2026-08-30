import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { OrdersBoard } from '@/components/dashboard/orders-board';
import type { OrderRow } from '@/components/dashboard/live-orders-panel';
import { mapOrderRow } from '@/lib/queries/orders';
import type { Enums } from '@/types/database';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pedidos' };

const OPEN_STATUSES: Enums<'order_status'>[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'delivering',
];
const CLOSED_STATUSES: Enums<'order_status'>[] = ['completed', 'cancelled'];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { restaurant, staffRole } = await requireStaffContext();
  const { t } = await getI18n();
  const { view } = await searchParams;
  const showHistory = view === 'history';

  const supabase = await createServerSupabase();

  let query = supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('created_at', { ascending: false })
    .limit(showHistory ? 100 : 50);

  query = query.in('status', showHistory ? CLOSED_STATUSES : OPEN_STATUSES);

  const { data: orders } = await query;

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('*').in('order_id', orderIds)
    : { data: [] };

  const tableIds = [...new Set((orders ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
  const { data: tables } = tableIds.length
    ? await supabase.from('tables').select('id, name').in('id', tableIds)
    : { data: [] };
  const tableNames = new Map((tables ?? []).map((tb) => [tb.id, tb.name]));

  const rows: OrderRow[] = (orders ?? []).map((order) =>
    mapOrderRow(order, items ?? [], order.table_id ? (tableNames.get(order.table_id) ?? null) : null),
  );

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.liveOrders}</h1>

      <OrdersBoard
        restaurantId={restaurant.id}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        orders={rows}
        showHistory={showHistory}
        staffRole={staffRole}
      />
    </div>
  );
}
