import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { RestaurantAnalytics, type AnalyticsData } from '@/components/dashboard/restaurant-analytics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analítica' };

/** Resuelve el rango a partir de la URL, con 30 días como valor de partida. */
/** Fecha de calendario en hora local: toISOString() la desplazaría a UTC. */
function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveRange(params: { days?: string; from?: string; to?: string }) {
  const parseDate = (value?: string) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const from = parseDate(params.from);
  const to = parseDate(params.to);

  if (from && to && to >= from) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1); // el rango es inclusivo por el lado derecho
    return { from, to: end, days: Math.round((end.getTime() - from.getTime()) / 86_400_000), custom: true };
  }

  const days = Math.min(Math.max(Number(params.days) || 30, 1), 365);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  return { from: start, to: end, days, custom: false };
}

export default async function DashboardAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const { restaurant } = await requireStaffContext();
  const { t } = await getI18n();
  const params = await searchParams;
  const range = resolveRange(params);

  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc('restaurant_analytics', {
    p_restaurant_id: restaurant.id,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.analytics.title}</h1>
        <p className="mt-1 text-sm text-ink-300">{restaurant.name}</p>
      </div>

      <RestaurantAnalytics
        data={(data as unknown as AnalyticsData | null) ?? null}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        range={{
          days: range.days,
          custom: range.custom,
          from: localDay(range.from),
          to: localDay(new Date(range.to.getTime() - 86_400_000)),
        }}
      />
    </div>
  );
}
