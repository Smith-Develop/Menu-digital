import { getI18n } from '@/i18n';
import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { getPublicOrigin } from '@/lib/request-url';
import { TablesManager } from '@/components/dashboard/tables-manager';
import { ShareLinks } from '@/components/dashboard/share-links';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mesas y QR' };

export default async function TablesPage() {
  const { restaurant, subscription } = await requireSection('tables');
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const siteUrl = await getPublicOrigin();

  const { data: tables } = await supabase
    .from('tables')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('name');

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.tables}</h1>
        <p className="mt-1 text-sm text-ink-300">
          {(tables ?? []).length}
          {subscription?.plan?.max_tables ? ` / ${subscription.plan.max_tables}` : ''}
        </p>
      </div>

      <ShareLinks siteUrl={siteUrl} slug={restaurant.slug} name={restaurant.name} />

      <TablesManager
        siteUrl={siteUrl}
        restaurantName={restaurant.name}
        tables={(tables ?? []).map((table) => ({
          id: table.id,
          code: table.code,
          name: table.name,
          zone: table.zone,
          seats: table.seats,
          isActive: table.is_active,
        }))}
      />
    </div>
  );
}
