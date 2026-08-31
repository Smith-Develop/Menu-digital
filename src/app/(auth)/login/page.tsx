import Link from 'next/link';
import { getI18n } from '@/i18n';
import { getAuthScreens } from '@/lib/auth-screens';
import { getBrand } from '@/lib/brand';
import { AuthCard } from '@/components/auth/auth-card';
import { SocialButtons } from '@/components/auth/social-buttons';
import { LoginForm } from '@/components/auth/login-form';

export const metadata = { title: 'Iniciar sesión' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ t }, screens, brand] = await Promise.all([getI18n(), getAuthScreens(), getBrand()]);
  const { next } = await searchParams;

  return (
    <AuthCard
      title={screens.loginTitle}
      subtitle={screens.loginSubtitle}
      imageUrl={screens.loginImageUrl}
      logoUrl={brand.logoUrl}
      appName={brand.appName}
      footer={
        <p className="mt-7 text-center text-sm text-ink-300">
          {t.auth.noAccount}{' '}
          <Link href="/register" className="font-bold text-brand">
            {t.auth.signUp}
          </Link>
        </p>
      }
    >
      <LoginForm nextPath={next ?? '/dashboard'} />

      <SocialButtons
        google={screens.socialGoogle}
        facebook={screens.socialFacebook}
        apple={screens.socialApple}
      />
    </AuthCard>
  );
}
