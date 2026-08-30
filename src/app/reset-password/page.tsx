import { getI18n } from '@/i18n';
import { getBrand } from '@/lib/brand';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Nueva contraseña' };

export default async function ResetPasswordPage() {
  const [{ t }, brand] = await Promise.all([getI18n(), getBrand()]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-soft px-5 py-10">
      <div className="w-full max-w-md rounded-sheet bg-white p-7 shadow-card animate-scale-in">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand font-display text-2xl font-bold text-brand-contrast">
          {brand.appName.charAt(0)}
        </span>
        <h1 className="text-center font-display text-xl font-bold text-ink">
          {t.auth.resetTitle}
        </h1>
        <p className="mt-1.5 text-center text-sm text-ink-300">{t.auth.resetSubtitle}</p>

        <ResetPasswordForm />
      </div>
    </div>
  );
}
