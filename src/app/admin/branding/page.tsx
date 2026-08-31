import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { getBrand } from '@/lib/brand';
import { getAuthScreens } from '@/lib/auth-screens';
import { BrandingForm } from '@/components/admin/branding-form';
import { PlatformSoundSettings } from '@/components/admin/platform-sound-settings';
import { createServerSupabase } from '@/lib/supabase/server';
import { resolveSounds, type SoundSettings } from '@/lib/sounds';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marca' };

export default async function BrandingPage() {
  await requireSuperadmin();
  const [{ t }, brand, screens] = await Promise.all([getI18n(), getBrand(), getAuthScreens()]);

  const supabase = await createServerSupabase();
  const { data: settings } = await supabase
    .from('app_settings')
    .select('sound_settings')
    .eq('id', true)
    .maybeSingle();
  const { data: slidesRaw } = await supabase
    .from('onboarding_slides')
    .select('*')
    .order('position');

  const sounds = resolveSounds(settings?.sound_settings as Partial<SoundSettings> | null, null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.branding}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.admin.brandingHint}</p>
      </div>

      <BrandingForm
        initialScreens={screens}
        initial={brand}
        slides={(slidesRaw ?? []).map((slide) => ({
          id: slide.id,
          title: slide.title,
          subtitle: slide.subtitle,
          imageUrl: slide.image_url,
          position: slide.position,
          isActive: slide.is_active,
        }))}
        soundsSlot={<PlatformSoundSettings initial={sounds} />}
      />
    </div>
  );
}
