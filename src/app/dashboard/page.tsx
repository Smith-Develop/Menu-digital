import Link from 'next/link';
import { BellRing, Receipt, TrendingUp, Utensils } from 'lucide-react';
import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import { StatCard } from '@/components/dashboard/stat-card';
import { RevenueChart } from '@/components/dashboard/revenue-chart';
import { LiveOrdersPanel } from '@/components/dashboard/live-orders-panel';
import type { OrderRow } from '@/components/dashboard/live-orders-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Panel' };

type Stats = {
  orders_today: number;
  revenue_today_cents: number;
  active_orders: number;
  pending_calls: number;
  revenue_series: { day: string; cents: number }[];
  top_products: { name: string; qty: number; cents: number }[];
};

export default async function DashboardOverview() {
  const { restaurant, staffRole } = await requireStaffContext();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: statsRaw }, { data: orders }, { data: calls }] = await Promise.all([
    supabase.rpc('restaurant_stats', { p_restaurant_id: restaurant.id, p_days: 7 }),
    supabase
      .from('orders')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivering'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('waiter_calls')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const stats = (statsRaw as unknown as Stats | null) ?? {
    orders_today: 0,
    revenue_today_cents: 0,
    active_orders: 0,
    pending_calls: 0,
    revenue_series: [],
    top_products: [],
  };

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('*').in('order_id', orderIds)
    : { data: [] };

  const tableIds = [...new Set((orders ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
  const { data: tables } = tableIds.length
    ? await supabase.from('tables').select('id, name').in('id', tableIds)
    : { data: [] };
  const tableNames = new Map((tables ?? []).map((tb) => [tb.id, tb.name]));

  const rows: OrderRow[] = (orders ?? []).map((order) => ({
    id: order.id,
    code: order.code,
    type: order.type,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    totalCents: order.total_cents,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    address: order.address,
    tableName: order.table_id ? (tableNames.get(order.table_id) ?? null) : null,
    notes: order.notes,
    createdAt: order.created_at,
    items: (items ?? [])
      .filter((i) => i.order_id === order.id)
      .map((i) => ({
        id: i.id,
        name: i.name_snapshot,
        quantity: i.quantity,
        options: Array.isArray(i.options)
          ? (i.options as { name: string }[]).map((o) => o.name)
          : [],
        notes: i.notes,
        status: i.status,
      })),
  }));

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
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t.dashboard.revenueToday}
          value={formatMoney(
            stats.revenue_today_cents,
            restaurant.currency,
            restaurant.currency_decimals,
          )}
          tone="success"
        />
        <StatCard
          icon={<Utensils className="h-5 w-5" />}
          label={t.dashboard.activeOrders}
          value={String(stats.active_orders)}
          tone="brand"
        />
        <StatCard
          icon={<BellRing className="h-5 w-5" />}
          label={t.dashboard.pendingCalls}
          value={String(stats.pending_calls)}
          tone={stats.pending_calls > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RevenueChart
            title={t.dashboard.revenueChart}
            series={stats.revenue_series}
            currency={restaurant.currency}
            currencyDecimals={restaurant.currency_decimals}
          />
        </div>

        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <h2 className="mb-4 font-display text-base font-bold text-ink-700">
            {t.dashboard.topProducts}
          </h2>
          {stats.top_products.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-300">{t.common.empty}</p>
          ) : (
            <ol className="space-y-3">
              {stats.top_products.map((product, index) => (
                <li key={product.name} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-600">
                    {product.name}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-ink-300">×{product.qty}</span>
                  <span className="shrink-0 text-sm font-bold text-ink-700">
                    {formatMoney(product.cents, restaurant.currency, restaurant.currency_decimals)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

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
