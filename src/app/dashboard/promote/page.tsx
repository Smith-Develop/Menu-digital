import { notFound } from 'next/navigation';
import { requireStaffContext } from '@/lib/auth';
import { canAccessSection } from '@/lib/auth-permissions';
import { createServerSupabase } from '@/lib/supabase/server';
import { PromoteView, type MySponsorship } from '@/components/dashboard/promote-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Destacar' };

export default async function PromotePage() {
  const { restaurant, staffRole } = await requireStaffContext();
  if (!canAccessSection('promote', staffRole)) notFound();

  const supabase = await createServerSupabase();
  const [{ data: contratado }, { count: banners }] = await Promise.all([
    supabase
      .from('sponsorships')
      .select('id, kind, starts_on, ends_on, days, total_cents, currency, status')
      .eq('restaurant_id', restaurant.id)
      .order('starts_on', { ascending: false })
      .limit(20),
    supabase
      .from('banners')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true),
  ]);

  const mine: MySponsorship[] = (contratado ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
    days: s.days,
    totalCents: s.total_cents,
    currency: s.currency,
    status: s.status,
  }));

  return (
    <PromoteView
      citySlug={restaurant.city_slug}
      cityName={restaurant.city}
      hasBanners={(banners ?? 0) > 0}
      mine={mine}
    />
  );
}
