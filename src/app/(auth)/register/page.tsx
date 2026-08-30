import Link from 'next/link';
import { getI18n } from '@/i18n';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata = { title: 'Crear cuenta' };

export default async function RegisterPage() {
  const { t } = await getI18n();

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-ink">{t.auth.signUp}</h1>
      <p className="mt-1.5 text-sm text-ink-300">{t.auth.signUpSubtitle}</p>

      <RegisterForm />

      <p className="mt-8 text-center text-sm text-ink-300">
        {t.auth.hasAccount}{' '}
        <Link href="/login" className="font-bold text-brand">
          {t.auth.signIn}
        </Link>
      </p>
    </>
  );
}
