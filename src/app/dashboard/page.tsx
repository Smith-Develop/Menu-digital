import Link from 'next/link';
import { resolveSounds, type SoundSettings } from '@/lib/sounds';
import { BellRing, Receipt, TrendingUp, Utensils, Wallet } from 'lucide-react';
import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import { StatCard } from '@/components/dashboard/stat-card';
import { LiveOrdersPanel } from '@/components/dashboard/live-orders-panel';
import type { OrderRow } from '@/components/dashboard/live-orders-panel';
import { mapOrderRow } from '@/lib/queries/orders';
import { RestaurantAnalytics, type AnalyticsData } from '@/components/dashboard/restaurant-analytics';
import { resolveRange, localDay } from '@/lib/analytics-range';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Panel' };

type Stats = {
  orders_today: number;
  /** Lo entregado hoy, cobrado o no. */
  revenue_today_cents: number;
  /** Lo que ha entrado en caja hoy. */
  collected_today_cents: number;
  /** Lo que queda por cobrar, sin límite de fecha. */
  pending_cents: number;
  pending_orders: number;
  active_orders: number;
  pending_calls: number;
  revenue_series: { day: string; cents: number }[];
  top_products: { name: string; qty: number; cents: number }[];
};

export default async function DashboardOverview({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const { restaurant, staffRole } = await requireStaffContext();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const range = resolveRange(await searchParams);

  const [{ data: statsRaw }, { data: orders }, { data: calls }, { data: analytics }] = await Promise.all([
    supabase.rpc('restaurant_stats', { p_restaurant_id: restaurant.id, p_days: 7 }),
    supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'served', 'delivering'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('waiter_calls')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.rpc('restaurant_analytics', {
      p_restaurant_id: restaurant.id,
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
    }),
  ]);

  const stats = (statsRaw as unknown as Stats | null) ?? {
    orders_today: 0,
    revenue_today_cents: 0,
    collected_today_cents: 0,
    pending_cents: 0,
    pending_orders: 0,
    active_orders: 0,
    pending_calls: 0,
    revenue_series: [],
    top_products: [],
  };

  // Los mismos tonos que la cocina: el restaurante manda sobre la plataforma.
  const { data: platform } = await supabase
    .from('app_settings')
    .select('sound_settings')
    .eq('id', true)
    .maybeSingle();
  const sounds: SoundSettings = resolveSounds(
    platform?.sound_settings as Partial<SoundSettings> | null,
    restaurant.sound_settings as Partial<SoundSettings> | null,
  );

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

  // Las mesas de los avisos cuentan igual que las de los pedidos: si sólo se
  // miran estas últimas, un aviso de una mesa que no tiene pedido en curso sale
  // sin nombre y nadie sabe a dónde ir.
  const tableIds = [
    ...new Set(
      [
        ...(orders ?? []).map((o) => o.table_id),
        ...(calls ?? []).map((c) => c.table_id),
      ].filter(Boolean),
    ),
  ] as string[];
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

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.title}</h1>
        <p className="mt-1 text-sm text-ink-300">{restaurant.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label={t.dashboard.ordersToday}
          value={String(stats.orders_today)}
        />
        {/* La cifra que manda es la caja: lo que se ha cobrado de verdad. Antes
            aquí salía lo entregado, cobrado o no, así que un pedido que nadie
            había pagado engordaba los ingresos del día. */}
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t.dashboard.collectedToday}
          value={formatMoney(
            stats.collected_today_cents,
            restaurant.currency,
            restaurant.currency_decimals,
          )}
          hint={`${t.dashboard.soldToday}: ${formatMoney(
            stats.revenue_today_cents,
            restaurant.currency,
            restaurant.currency_decimals,
          )}`}
          tone="success"
        />
        <StatCard
          icon={<Utensils className="h-5 w-5" />}
          label={t.dashboard.activeOrders}
          value={String(stats.active_orders)}
          tone="brand"
        />
        {/* Lo que falta por cobrar sólo se enseña si lo hay: en un local al día
            esta tarjeta no aparece, y cuando aparece es porque hay que actuar. */}
        {stats.pending_cents > 0 ? (
          <StatCard
            icon={<Wallet className="h-5 w-5" />}
            label={t.dashboard.pendingPayment}
            value={formatMoney(
              stats.pending_cents,
              restaurant.currency,
              restaurant.currency_decimals,
            )}
            hint={`${stats.pending_orders} ${t.analytics.ordersShort}`}
            tone="warning"
          />
        ) : (
          <StatCard
            icon={<BellRing className="h-5 w-5" />}
            label={t.dashboard.pendingCalls}
            value={String(stats.pending_calls)}
            tone={stats.pending_calls > 0 ? 'warning' : 'neutral'}
          />
        )}
      </div>

      {/* Las mismas cifras que tenía la pantalla de Analítica, ahora aquí: eran
          dos sitios distintos para mirar lo mismo. */}
      <RestaurantAnalytics
        data={(analytics as unknown as AnalyticsData | null) ?? null}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        range={{
          days: range.days,
          custom: range.custom,
          from: localDay(range.from),
          to: localDay(new Date(range.to.getTime() - 86_400_000)),
        }}
        basePath="/dashboard"
      />

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink-700">{t.dashboard.liveOrders}</h2>
          <Link href="/dashboard/orders" className="text-sm font-semibold text-brand">
            {t.common.seeAll} ›
          </Link>
        </div>

        <LiveOrdersPanel
          restaurantId={restaurant.id}
          currency={restaurant.currency}
          currencyDecimals={restaurant.currency_decimals}
          sounds={sounds}
          initialOrders={rows}
          initialCalls={(calls ?? []).map((c) => ({
            id: c.id,
            type: c.type,
            tableId: c.table_id,
            tableName: tableNames.get(c.table_id) ?? null,
            createdAt: c.created_at,
          }))}
          staffRole={staffRole}
        />
      </section>
    </div>
  );
}
