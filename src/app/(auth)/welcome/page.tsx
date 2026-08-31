import { redirect } from 'next/navigation';
import { getBrand } from '@/lib/brand';
import { getAuthScreens, getOnboardingSlides } from '@/lib/auth-screens';
import { getSessionProfile } from '@/lib/auth';
import { resolveHomeForCurrentUser } from '@/app/actions/auth';
import { Onboarding } from '@/components/auth/onboarding';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bienvenido' };

export default async function WelcomePage() {
  const [profile, brand, screens, slides] = await Promise.all([
    getSessionProfile(),
    getBrand(),
    getAuthScreens(),
    getOnboardingSlides(),
  ]);

  // Quien ya tiene cuenta abierta ve la portada de bienvenida y entra: la
  // presentación explica lo que es la aplicación y eso ya lo sabe.
  const presentacion = profile ? [] : screens.onboardingEnabled ? slides : [];

  // Sin portada que enseñar tampoco hay nada que esperar.
  if (!screens.splashEnabled && presentacion.length === 0) {
    redirect(profile ? await resolveHomeForCurrentUser() : '/');
  }

  return (
    <Onboarding
      slides={presentacion}
      brand={{
        appName: brand.appName,
        tagline: brand.tagline,
        logoUrl: brand.logoUrl,
        primaryColor: brand.primaryColor,
      }}
      showSplash={screens.splashEnabled}
      exitTo={profile ? await resolveHomeForCurrentUser() : '/'}
      splashSeconds={screens.splashSeconds}
      splash={{
        imageUrl: screens.splashImageUrl,
        title: screens.splashTitle,
        subtitle: screens.splashSubtitle,
      }}
    />
  );
}
