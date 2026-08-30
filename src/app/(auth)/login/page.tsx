import Link from 'next/link';
import { getI18n } from '@/i18n';
import { LoginForm } from '@/components/auth/login-form';

export const metadata = { title: 'Iniciar sesión' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { t } = await getI18n();
  const { next } = await searchParams;

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-ink">{t.auth.signIn}</h1>
      <p className="mt-1.5 text-sm text-ink-300">{t.auth.signInSubtitle}</p>

      <LoginForm nextPath={next ?? '/dashboard'} />

      <p className="mt-8 text-center text-sm text-ink-300">
        {t.auth.noAccount}{' '}
        <Link href="/register" className="font-bold text-brand">
          {t.auth.signUp}
        </Link>
      </p>
    </>
  );
}
