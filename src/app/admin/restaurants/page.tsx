import { getI18n } from '@/i18n';
import { requireSuperadmin, daysUntil, subscriptionIsLive } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { RestaurantsTable } from '@/components/admin/restaurants-table';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Restaurantes' };

export default async function AdminRestaurantsPage() {
  await requireSuperadmin();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: restaurants }, { data: plans }] = await Promise.all([
    supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
    supabase.from('plans').select('*').eq('is_active', true).order('position'),
  ]);

  const restaurantIds = (restaurants ?? []).map((r) => r.id);
  const { data: subscriptions } = restaurantIds.length
    ? await supabase
        .from('subscriptions')
        .select('*')
        .in('restaurant_id', restaurantIds)
        .in('status', ['trialing', 'active', 'past_due'])
    : { data: [] };

  const planNames = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const subByRestaurant = new Map((subscriptions ?? []).map((s) => [s.restaurant_id, s]));

  const ownerIds = [...new Set((restaurants ?? []).map((r) => r.owner_id).filter(Boolean))] as string[];
  const { data: owners } = ownerIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ownerIds)
    : { data: [] };
  const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t.admin.restaurants}</h1>

      <RestaurantsTable
        plans={(plans ?? []).map((plan) => ({
          id: plan.id,
          name: plan.name,
          interval: plan.interval,
          priceCents: plan.price_cents,
          currency: plan.currency,
        }))}
        restaurants={(restaurants ?? []).map((restaurant) => {
          const subscription = subByRestaurant.get(restaurant.id) ?? null;
          const owner = restaurant.owner_id ? ownerById.get(restaurant.owner_id) : null;

          return {
            id: restaurant.id,
            name: restaurant.name,
            slug: restaurant.slug,
            city: restaurant.city,
            logoUrl: restaurant.logo_url,
            isActive: restaurant.is_active,
            createdAt: restaurant.created_at,
            ownerName: owner?.full_name ?? owner?.email ?? null,
            subscription: subscription
              ? {
                  id: subscription.id,
                  planId: subscription.plan_id,
                  planName: subscription.plan_id ? (planNames.get(subscription.plan_id) ?? null) : null,
                  status: subscription.status,
                  periodEnd: subscription.current_period_end,
                  daysLeft: daysUntil(subscription.current_period_end),
                  isLive: subscriptionIsLive({
                    ...subscription,
                    plan: null,
                  }),
                }
              : null,
          };
        })}
      />
    </div>
  );
}
