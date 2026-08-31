import { getI18n } from '@/i18n';
import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { FloorView, type FloorTable } from '@/components/dashboard/floor-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sala' };

export default async function FloorPage() {
  const { restaurant, staffRole, profile } = await requireSection('floor');
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: mesas }, { data: equipo }] = await Promise.all([
    supabase.rpc('floor_status', { p_restaurant_id: restaurant.id }),
    supabase
      .from('restaurant_staff')
      .select('user_id, role')
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true),
  ]);

  const userIds = (equipo ?? []).map((m) => m.user_id);
  const { data: perfiles } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.floor.title}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.floor.hint}</p>
      </div>

      <FloorView
        tables={(mesas as unknown as FloorTable[] | null) ?? []}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        slug={restaurant.slug}
        currentUserId={profile.id}
        canAssign={staffRole !== 'waiter'}
        waiters={(perfiles ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? p.email ?? '—',
        }))}
      />
    </div>
  );
}
