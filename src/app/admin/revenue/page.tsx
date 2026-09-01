import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { PlatformRevenuePanel, type PlatformRevenue } from '@/components/admin/platform-revenue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ingresos' };

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSuperadmin();
  const { t } = await getI18n();
  const { days } = await searchParams;

  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc('platform_revenue', {
    p_days: Math.min(Math.max(Number(days) || 30, 1), 365),
  });

  const vacio: PlatformRevenue = {
    fees_cents: 0,
    fees_count: 0,
    commission_cents: 0,
    commission_base_cents: 0,
    commission_restaurants_cents: 0,
    commission_couriers_cents: 0,
    pending_cents: 0,
    active_subscriptions: 0,
    paying_restaurants: 0,
    paying_couriers: 0,
    top_restaurants: [],
    pending_by_subject: [],
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.platformIncome}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.admin.revenueHint}</p>
      </div>

      <PlatformRevenuePanel
        data={(data as unknown as PlatformRevenue | null) ?? vacio}
        // La plataforma factura en una sola divisa; la de cada local es asunto
        // suyo y no se mezcla con esto.
        currency="EUR"
      />
    </div>
  );
}
