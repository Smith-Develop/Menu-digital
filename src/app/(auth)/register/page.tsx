import Link from 'next/link';
import { getI18n } from '@/i18n';
import { getAuthScreens } from '@/lib/auth-screens';
import { getBrand } from '@/lib/brand';
import { AuthCard } from '@/components/auth/auth-card';
import { SocialButtons } from '@/components/auth/social-buttons';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata = { title: 'Crear cuenta' };

export default async function RegisterPage() {
  const [{ t }, screens, brand] = await Promise.all([getI18n(), getAuthScreens(), getBrand()]);

  return (
    <AuthCard
      title={screens.registerTitle}
      subtitle={screens.registerSubtitle}
      imageUrl={screens.registerImageUrl}
      logoUrl={brand.logoUrl}
      appName={brand.appName}
      footer={
        <p className="mt-7 text-center text-sm text-ink-300">
          {t.auth.hasAccount}{' '}
          <Link href="/login" className="font-bold text-brand">
            {t.auth.signIn}
          </Link>
        </p>
      }
    >
      <RegisterForm termsUrl={screens.termsUrl} />

      <SocialButtons
        google={screens.socialGoogle}
        facebook={screens.socialFacebook}
        apple={screens.socialApple}
      />
    </AuthCard>
  );
}
