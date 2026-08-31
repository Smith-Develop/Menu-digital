import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { PlatformBanners } from '@/components/admin/platform-banners';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Banners' };

export default async function AdminBannersPage() {
  await requireSuperadmin();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: banners }, { data: settings }, { data: ciudades }] = await Promise.all([
    supabase
      .from('banners')
      .select('*')
      .is('restaurant_id', null)
      .order('position')
      .order('created_at', { ascending: false }),
    supabase.from('app_settings').select('banner_rotation_seconds').eq('id', true).maybeSingle(),
    supabase.from('restaurants').select('city, city_slug').not('city_slug', 'is', null),
  ]);

  // Las ciudades que se ofrecen son aquellas donde de verdad hay restaurantes.
  const porSlug = new Map<string, string>();
  for (const fila of ciudades ?? []) {
    if (fila.city_slug && fila.city) porSlug.set(fila.city_slug, fila.city);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.homeBanners}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.admin.homeBannersHint}</p>
      </div>

      <PlatformBanners
        rotationSeconds={settings?.banner_rotation_seconds ?? 6}
        cities={[...porSlug.entries()].map(([slug, name]) => ({ slug, name }))}
        banners={(banners ?? []).map((banner) => ({
          id: banner.id,
          title: banner.title,
          subtitle: banner.subtitle,
          imageUrl: banner.image_url,
          linkUrl: banner.link_url,
          isActive: banner.is_active,
          isPinned: banner.is_pinned,
          pinnedCities: banner.pinned_cities,
          position: banner.position,
        }))}
      />
    </div>
  );
}
