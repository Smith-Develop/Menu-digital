import { redirect } from 'next/navigation';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { ProfileForm } from '@/components/storefront/profile-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mis datos' };

export default async function ProfilePage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/account/profile');

  const { t } = await getI18n();

  return (
    <div className="page-enter flex-1 px-5 py-6 lg:px-0">
      <h1 className="font-display text-2xl font-bold text-ink">{t.account.myData}</h1>
      <p className="mt-1 text-sm text-ink-300">{t.account.myDataHint}</p>

      <ProfileForm
        initial={{
          fullName: profile.full_name ?? '',
          email: profile.email ?? '',
          phone: profile.phone ?? '',
          address: profile.address ?? '',
          city: profile.city ?? '',
          avatarUrl: profile.avatar_url,
        }}
      />
    </div>
  );
}
