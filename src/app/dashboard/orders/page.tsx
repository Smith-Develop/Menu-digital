import { getI18n } from '@/i18n';
import { resolveSounds, type SoundSettings } from '@/lib/sounds';
import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { OrdersBoard } from '@/components/dashboard/orders-board';
import { CourierCashPanel } from '@/components/dashboard/courier-cash';
import type { FloorTable } from '@/components/dashboard/floor-view';
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
  'served',
  'delivering',
];
const CLOSED_STATUSES: Enums<'order_status'>[] = ['completed', 'cancelled'];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { restaurant, staffRole, profile } = await requireSection('orders');
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
  // Efectivo cobrado en la puerta y aún no ingresado: esos pedidos siguen
  // contando para el local aunque el cliente ya tenga su comida.
  const { data: enCalle } = await supabase
    .from('orders')
    .select('courier_id, total_cents')
    .eq('restaurant_id', restaurant.id)
    .eq('payment_method', 'cash')
    .eq('status', 'completed')
    .is('cash_settled_at', null)
    .not('courier_id', 'is', null);

  const porRepartidor = new Map<string, { orders: number; cents: number }>();
  for (const fila of enCalle ?? []) {
    if (!fila.courier_id) continue;
    const actual = porRepartidor.get(fila.courier_id) ?? { orders: 0, cents: 0 };
    porRepartidor.set(fila.courier_id, {
      orders: actual.orders + 1,
      cents: actual.cents + fila.total_cents,
    });
  }

  const { data: repartidores } = porRepartidor.size
    ? await supabase.from('couriers').select('id, user_id').in('id', [...porRepartidor.keys()])
    : { data: [] };
  const { data: perfilesRepartidores } = (repartidores ?? []).length
    ? await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', (repartidores ?? []).map((c) => c.user_id))
    : { data: [] };

  const [{ data: mesas }, { data: equipo }] = await Promise.all([
    supabase.rpc('floor_status', { p_restaurant_id: restaurant.id }),
    supabase
      .from('restaurant_staff')
      .select('user_id')
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true),
  ]);

  const equipoIds = (equipo ?? []).map((m) => m.user_id);
  const { data: perfilesEquipo } = equipoIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', equipoIds)
    : { data: [] };

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
      <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.floorAndOrders}</h1>

      <CourierCashPanel
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        pending={(repartidores ?? []).map((courier) => {
          const persona = (perfilesRepartidores ?? []).find((p) => p.id === courier.user_id);
          const saldo = porRepartidor.get(courier.id) ?? { orders: 0, cents: 0 };
          return {
            courierId: courier.id,
            name: persona?.full_name ?? persona?.email ?? '—',
            orders: saldo.orders,
            cents: saldo.cents,
          };
        })}
      />

      <OrdersBoard
        sounds={sounds}
        tables={(mesas as unknown as FloorTable[] | null) ?? []}
        waiters={(perfilesEquipo ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? p.email ?? '—',
        }))}
        slug={restaurant.slug}
        currentUserId={profile.id}
        canManageFloor={staffRole !== 'waiter'}
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
