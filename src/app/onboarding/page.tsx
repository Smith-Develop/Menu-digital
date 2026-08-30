import { redirect } from 'next/navigation';
import { getI18n } from '@/i18n';
import { requireProfile, getStaffContext } from '@/lib/auth';
import { OnboardingForm } from '@/components/dashboard/onboarding-form';

export const metadata = { title: 'Configura tu restaurante' };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  await requireProfile('/onboarding');
  const context = await getStaffContext();
  if (context) redirect('/dashboard');

  const { t } = await getI18n();
  const { name } = await searchParams;

  return (
    <div className="min-h-dvh bg-surface-soft px-5 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="font-display text-2xl font-bold text-ink">{t.auth.signUpCta}</h1>
        <p className="mt-1.5 text-sm text-ink-300">{t.auth.signUpSubtitle}</p>
        <OnboardingForm defaultName={name ?? ''} />
      </div>
    </div>
  );
}
