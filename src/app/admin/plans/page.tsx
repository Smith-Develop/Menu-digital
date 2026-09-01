import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { PlansManager } from '@/components/admin/plans-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Planes' };

export default async function AdminPlansPage() {
  await requireSuperadmin();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const { data: plans } = await supabase.from('plans').select('*').order('position');

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('plan_id')
    .in('status', ['trialing', 'active', 'past_due']);

  const usage = new Map<string, number>();
  for (const row of subscriptions ?? []) {
    if (row.plan_id) usage.set(row.plan_id, (usage.get(row.plan_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t.admin.plans}</h1>

      <PlansManager
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
          allowsDelivery: plan.allows_delivery,
          audience: (plan.audience ?? 'restaurant') as 'restaurant' | 'courier',
          maxRestaurants: plan.max_restaurants,
          allowsPool: plan.allows_pool,
          poolPriority: plan.pool_priority,
          commissionRate: Number(plan.commission_rate ?? 0),
          features: Array.isArray(plan.features) ? (plan.features as string[]) : [],
          stripePriceId: plan.stripe_price_id,
          isActive: plan.is_active,
          position: plan.position,
          subscribers: usage.get(plan.id) ?? 0,
        }))}
      />
    </div>
  );
}
