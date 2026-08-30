import { getI18n } from '@/i18n';
import { requireStaffContext, daysUntil, subscriptionIsLive } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { stripeEnv } from '@/lib/env';
import { SubscriptionView } from '@/components/dashboard/subscription-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Suscripción' };

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { restaurant, subscription } = await requireStaffContext();
  const { t } = await getI18n();
  const { payment } = await searchParams;
  const supabase = await createServerSupabase();

  const [{ data: plans }, { data: payments }] = await Promise.all([
    supabase.from('plans').select('*').eq('is_active', true).order('position'),
    supabase
      .from('payments')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t.subscription.title}</h1>

      <SubscriptionView
        stripeEnabled={stripeEnv.isConfigured}
        paymentResult={payment === 'success' ? 'success' : payment === 'cancelled' ? 'cancelled' : null}
        current={
          subscription
            ? {
                status: subscription.status,
                periodEnd: subscription.current_period_end,
                daysLeft: daysUntil(subscription.current_period_end),
                isLive: subscriptionIsLive(subscription),
                planId: subscription.plan_id,
                planName: subscription.plan?.name ?? null,
              }
            : null
        }
        plans={(plans ?? []).map((plan) => ({
          id: plan.id,
          name: plan.name,
          description: plan.description,
          interval: plan.interval,
          priceCents: plan.price_cents,
          currency: plan.currency,
          trialDays: plan.trial_days,
          maxTables: plan.max_tables,
          maxProducts: plan.max_products,
          maxStaff: plan.max_staff,
          allows3d: plan.allows_3d,
          features: Array.isArray(plan.features) ? (plan.features as string[]) : [],
        }))}
        payments={(payments ?? []).map((p) => ({
          id: p.id,
          amountCents: p.amount_cents,
          currency: p.currency,
          status: p.status,
          createdAt: p.created_at,
          paidAt: p.paid_at,
        }))}
      />
    </div>
  );
}
