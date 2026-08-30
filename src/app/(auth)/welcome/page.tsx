import { redirect } from 'next/navigation';
import { getBrand } from '@/lib/brand';
import { getAuthScreens, getOnboardingSlides } from '@/lib/auth-screens';
import { getSessionProfile } from '@/lib/auth';
import { resolveHomeForCurrentUser } from '@/app/actions/auth';
import { Onboarding } from '@/components/auth/onboarding';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bienvenido' };

export default async function WelcomePage() {
  // Quien ya tiene sesión no necesita presentaciones.
  const profile = await getSessionProfile();
  if (profile) redirect(await resolveHomeForCurrentUser());

  const [brand, screens, slides] = await Promise.all([
    getBrand(),
    getAuthScreens(),
    getOnboardingSlides(),
  ]);

  if (!screens.onboardingEnabled || slides.length === 0) redirect('/login');

  return (
    <Onboarding
      slides={slides}
      brand={{
        appName: brand.appName,
        tagline: brand.tagline,
        logoUrl: brand.logoUrl,
        primaryColor: brand.primaryColor,
      }}
      showSplash={screens.splashEnabled}
    />
  );
}
