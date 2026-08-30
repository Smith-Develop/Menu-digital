import Link from 'next/link';
import { AlertTriangle, CreditCard, Store, TrendingUp } from 'lucide-react';
import { getI18n } from '@/i18n';
import { requireSuperadmin, daysUntil } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { StatCard } from '@/components/dashboard/stat-card';
import { Badge } from '@/components/ui/misc';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { AnalyticsBoard, type PlatformStats } from '@/components/admin/analytics-board';
import { RangePicker } from '@/components/admin/range-picker';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Superadministración' };

export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSuperadmin();
  const { t, locale } = await getI18n();
  const supabase = await createServerSupabase();

  const { days: daysParam } = await searchParams;
  const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);

  const { data: statsRaw } = await supabase.rpc('platform_stats', { p_days: days });
  const stats = statsRaw as unknown as PlatformStats | null;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [restaurants, activeSubs, payments] = await Promise.all([
    supabase.from('restaurants').select('id, is_active', { count: 'exact' }),
    supabase
      .from('subscriptions')
      .select('*')
      .in('status', ['trialing', 'active', 'past_due'])
      .order('current_period_end'),
    supabase
      .from('payments')
      .select('amount_cents, currency')
      .eq('status', 'paid')
      .gte('created_at', monthStart.toISOString()),
  ]);

  const subs = activeSubs.data ?? [];
  const expiringSoon = subs.filter((s) => {
    const left = daysUntil(s.current_period_end);
    return left >= 0 && left <= 7;
  });

  const restaurantIds = [...new Set(expiringSoon.map((s) => s.restaurant_id))];
  const { data: expiringRestaurants } = restaurantIds.length
    ? await supabase.from('restaurants').select('id, name, slug').in('id', restaurantIds)
    : { data: [] };
  const byId = new Map((expiringRestaurants ?? []).map((r) => [r.id, r]));

  const monthlyRevenue = (payments.data ?? []).reduce((sum, p) => sum + p.amount_cents, 0);

  return (
    <div className="space-y-7">
      <h1 className="font-display text-2xl font-bold text-ink">{t.admin.title}</h1>

      {stats && (
        <>
          <RangePicker current={days} />
          <AnalyticsBoard stats={stats} days={days} />
        </>
      )}

      <h2 className="font-display text-lg font-bold text-ink-700">{t.admin.subscriptions}</h2>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Store className="h-5 w-5" />}
          label={t.admin.totalRestaurants}
          value={String(restaurants.count ?? 0)}
          hint={`${(restaurants.data ?? []).filter((r) => r.is_active).length} ${t.common.active.toLowerCase()}`}
        />
        <StatCard
          icon={<CreditCard className="h-5 w-5" />}
          label={t.admin.activeSubscriptions}
          value={String(subs.length)}
          tone="brand"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label={t.admin.expiringSoon}
          value={String(expiringSoon.length)}
          tone={expiringSoon.length > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={t.admin.monthlyRevenue}
          value={formatMoney(monthlyRevenue, payments.data?.[0]?.currency ?? 'EUR')}
          tone="success"
        />
      </div>

      {expiringSoon.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="mb-4 flex items-center gap-2 font-display text-base font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {t.admin.expiringSoon}
          </h2>
          <ul className="space-y-2">
            {expiringSoon.map((subscription) => {
              const restaurant = byId.get(subscription.restaurant_id);
              const left = daysUntil(subscription.current_period_end);
              return (
                <li
                  key={subscription.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-700">
                    {restaurant?.name ?? '—'}
                  </span>
                  <span className="text-xs text-ink-300">
                    {t.admin.expiresOn} {formatDate(subscription.current_period_end, locale)}
                  </span>
                  <Badge tone={left <= 2 ? 'danger' : 'warning'}>{left} d</Badge>
                </li>
              );
            })}
          </ul>
          <Link href="/admin/restaurants" className="mt-4 inline-block text-sm font-bold text-amber-800 underline">
            {t.admin.restaurants} ›
          </Link>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/restaurants"
          className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-chip transition-shadow hover:shadow-card"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-bold text-ink-700">{t.admin.restaurants}</p>
            <p className="text-sm text-ink-300">{t.admin.assignPlan}</p>
          </div>
        </Link>

        <Link
          href="/admin/plans"
          className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-chip transition-shadow hover:shadow-card"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/25 text-ink-700">
            <CreditCard className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-bold text-ink-700">{t.admin.plans}</p>
            <p className="text-sm text-ink-300">{t.admin.newPlan}</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
