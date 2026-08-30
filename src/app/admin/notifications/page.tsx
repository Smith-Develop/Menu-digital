import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { listCities } from '@/lib/customer-location';
import { NotificationsManager } from '@/components/admin/notifications-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notificaciones' };

export default async function AdminNotificationsPage() {
  await requireSuperadmin();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: notifications }, cities] = await Promise.all([
    supabase.from('notifications').select('*').order('created_at', { ascending: false }),
    listCities(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.notifications}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.admin.notificationsHint}</p>
      </div>

      <NotificationsManager
        cities={cities}
        notifications={(notifications ?? []).map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          imageUrl: n.image_url,
          linkUrl: n.link_url,
          linkLabel: n.link_label,
          audience: n.audience,
          cities: n.cities,
          startsAt: n.starts_at,
          endsAt: n.ends_at,
          isActive: n.is_active,
        }))}
      />
    </div>
  );
}
