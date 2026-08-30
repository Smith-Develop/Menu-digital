import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { AdminAccountForm } from '@/components/admin/account-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi cuenta' };

export default async function AdminAccountPage() {
  const profile = await requireSuperadmin();
  const { t } = await getI18n();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.myAccount}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.admin.myAccountHint}</p>
      </div>

      <AdminAccountForm
        fullName={profile.full_name ?? ''}
        email={profile.email ?? ''}
      />
    </div>
  );
}
