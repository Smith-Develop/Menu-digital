import Link from 'next/link';
import { getI18n } from '@/i18n';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata = { title: 'Recuperar contraseña' };

export default async function ForgotPasswordPage() {
  const { t } = await getI18n();

  return (
    <>
      <h1 className="font-display text-2xl font-bold text-ink">{t.auth.forgotTitle}</h1>
      <p className="mt-1.5 text-sm text-ink-300">{t.auth.forgotSubtitle}</p>

      <ForgotPasswordForm />

      <p className="mt-8 text-center text-sm text-ink-300">
        <Link href="/login" className="font-bold text-brand">
          {t.auth.backToSignIn}
        </Link>
      </p>
    </>
  );
}
