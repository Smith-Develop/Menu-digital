import { notFound } from 'next/navigation';
import { requireSuperadmin, daysUntil, subscriptionIsLive } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { RestaurantSheet } from '@/components/admin/restaurant-sheet';

export const dynamic = 'force-dynamic';

export default async function AdminRestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperadmin();
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: restaurant } = await supabase.from('restaurants').select('*').eq('id', id).maybeSingle();
  if (!restaurant) notFound();

  const [
    { data: owner },
    { data: subscription },
    { data: plans },
    { data: staff },
    { data: payments },
    { count: products },
    { count: tables },
    { count: orders },
  ] = await Promise.all([
    restaurant.owner_id
      ? supabase.from('profiles').select('id, full_name, email, phone').eq('id', restaurant.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('subscriptions')
      .select('*')
      .eq('restaurant_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('plans').select('*').eq('is_active', true).order('position'),
    supabase.from('restaurant_staff').select('id, role, is_active').eq('restaurant_id', id),
    supabase
      .from('payments')
      .select('*')
      .eq('restaurant_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
    supabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', id),
  ]);

  const plan = subscription?.plan_id
    ? ((plans ?? []).find((p) => p.id === subscription.plan_id) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <RestaurantSheet
        restaurant={{
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          logoUrl: restaurant.logo_url,
          coverUrl: restaurant.cover_url,
          email: restaurant.email,
          phone: restaurant.phone,
          address: restaurant.address,
          city: restaurant.city,
          currency: restaurant.currency,
          currencyDecimals: restaurant.currency_decimals,
          isActive: restaurant.is_active,
          isOpen: restaurant.is_open,
          businessType: restaurant.business_type,
          createdAt: restaurant.created_at,
        }}
        owner={
          owner
            ? { id: owner.id, name: owner.full_name, email: owner.email, phone: owner.phone }
            : null
        }
        subscription={
          subscription
            ? {
                id: subscription.id,
                planId: subscription.plan_id,
                planName: plan?.name ?? null,
                status: subscription.status,
                periodEnd: subscription.current_period_end,
                daysLeft: daysUntil(subscription.current_period_end),
                isLive: subscriptionIsLive({ ...subscription, plan: null }),
              }
            : null
        }
        plans={(plans ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          interval: p.interval,
          priceCents: p.price_cents,
          currency: p.currency,
        }))}
        counts={{
          products: products ?? 0,
          tables: tables ?? 0,
          orders: orders ?? 0,
          staff: (staff ?? []).filter((s) => s.is_active).length,
        }}
        payments={(payments ?? []).map((p) => ({
          id: p.id,
          amountCents: p.amount_cents,
          currency: p.currency,
          status: p.status,
          createdAt: p.paid_at ?? p.created_at,
        }))}
      />
    </div>
  );
}
