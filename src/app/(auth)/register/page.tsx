import Link from 'next/link';
import { getI18n } from '@/i18n';
import { getAuthScreens } from '@/lib/auth-screens';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata = { title: 'Crear cuenta' };

export default async function RegisterPage() {
  const [{ t }, screens] = await Promise.all([getI18n(), getAuthScreens()]);

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-ink">{screens.registerTitle}</h1>
      <p className="mt-1.5 text-sm text-ink-300">{screens.registerSubtitle}</p>

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
