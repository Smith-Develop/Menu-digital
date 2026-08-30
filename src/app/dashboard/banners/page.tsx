import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { BannersManager } from '@/components/dashboard/banners-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Banners' };

export default async function BannersPage() {
  const { restaurant } = await requireStaffContext();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const { data: banners } = await supabase
    .from('banners')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('position');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.banners}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.dashboard.bannerHint}</p>
      </div>

      <BannersManager
        restaurantId={restaurant.id}
        restaurantSlug={restaurant.slug}
        banners={(banners ?? []).map((banner) => ({
          id: banner.id,
          title: banner.title,
          subtitle: banner.subtitle,
          imageUrl: banner.image_url,
          linkUrl: banner.link_url,
          position: banner.position,
          isActive: banner.is_active,
          startsAt: banner.starts_at,
          endsAt: banner.ends_at,
        }))}
      />
    </div>
  );
}
