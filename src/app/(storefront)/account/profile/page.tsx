import { redirect } from 'next/navigation';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { ProfileForm } from '@/components/storefront/profile-form';
import { AddressBook } from '@/components/storefront/address-book';
import { createServerSupabase } from '@/lib/supabase/server';
import { listPlaces } from '@/lib/queries/places';
import { getCustomerLocation } from '@/lib/customer-location';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mis datos' };

export default async function ProfilePage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/account/profile');

  const { t } = await getI18n();

  const supabase = await createServerSupabase();
  const [{ data: addresses }, countries, location] = await Promise.all([
    supabase
      .from('customer_addresses')
      .select('id, label, country, city, neighborhood, street, details, notes, full_line, is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false }),
    listPlaces(),
    getCustomerLocation(),
  ]);

  const libreta = (addresses ?? []).map((a) => ({
    ...a,
    full_line:
      a.full_line ?? [a.street, a.details, a.neighborhood, a.city].filter(Boolean).join(', '),
  }));

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

      <AddressBook
        addresses={libreta}
        countries={countries}
        defaultCity={location?.city ?? profile.city ?? null}
      />
    </div>
  );
}
