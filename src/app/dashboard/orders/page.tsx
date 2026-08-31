import { getI18n } from '@/i18n';
import { resolveSounds, type SoundSettings } from '@/lib/sounds';
import { requireSection } from '@/lib/auth';
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
  const { restaurant, staffRole } = await requireSection('orders');
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

  // Nombre del repartidor asignado, para enseñarlo en la tarjeta del pedido.
  const courierIds = [...new Set((orders ?? []).map((o) => o.courier_id).filter(Boolean))] as string[];
  const { data: couriers } = courierIds.length
    ? await supabase.from('couriers').select('id, user_id').in('id', courierIds)
    : { data: [] };
  const { data: courierProfiles } = (couriers ?? []).length
    ? await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', (couriers ?? []).map((c) => c.user_id))
    : { data: [] };
  const courierNames = new Map(
    (couriers ?? []).map((c) => {
      const person = (courierProfiles ?? []).find((p) => p.id === c.user_id);
      return [c.id, person?.full_name ?? person?.email ?? null];
    }),
  );

  const tableIds = [...new Set((orders ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
  const { data: tables } = tableIds.length
    ? await supabase.from('tables').select('id, name').in('id', tableIds)
    : { data: [] };
  const tableNames = new Map((tables ?? []).map((tb) => [tb.id, tb.name]));

  const rows: OrderRow[] = (orders ?? []).map((order) =>
    mapOrderRow(
      order,
      items ?? [],
      order.table_id ? (tableNames.get(order.table_id) ?? null) : null,
      order.courier_id ? (courierNames.get(order.courier_id) ?? null) : null,
    ),
  );

  // Los avisos de las mesas encabezan la pantalla: quien mira los pedidos en
  // curso es quien tiene que atenderlos, y antes sólo aparecían en el resumen.
  const { data: calls } = await supabase
    .from('waiter_calls')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .is('attended_at', null)
    .order('created_at', { ascending: false })
    .limit(10);

  const callTableIds = [...new Set((calls ?? []).map((c) => c.table_id))];
  const { data: callTables } = callTableIds.length
    ? await supabase.from('tables').select('id, name').in('id', callTableIds)
    : { data: [] };
  const callTableNames = new Map((callTables ?? []).map((tb) => [tb.id, tb.name]));

  const { data: platform } = await supabase
    .from('app_settings')
    .select('sound_settings')
    .eq('id', true)
    .maybeSingle();
  const sounds: SoundSettings = resolveSounds(
    platform?.sound_settings as Partial<SoundSettings> | null,
    restaurant.sound_settings as Partial<SoundSettings> | null,
  );

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.liveOrders}</h1>

      <OrdersBoard
        sounds={sounds}
        calls={(calls ?? []).map((c) => ({
          id: c.id,
          type: c.type,
          tableId: c.table_id,
          tableName: callTableNames.get(c.table_id) ?? null,
          createdAt: c.created_at,
        }))}
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
