import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { CouriersManager } from '@/components/dashboard/couriers-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Repartidores' };

export default async function DashboardCouriersPage() {
  const { restaurant } = await requireStaffContext();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const { data: links } = await supabase
    .from('restaurant_couriers')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('created_at');

  const courierIds = (links ?? []).map((l) => l.courier_id);
  const { data: couriers } = courierIds.length
    ? await supabase.from('couriers').select('*').in('id', courierIds)
    : { data: [] };

  const userIds = (couriers ?? []).map((c) => c.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds)
    : { data: [] };

  const courierById = new Map((couriers ?? []).map((c) => [c.id, c]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.courier.couriers}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.courier.noCouriersHint}</p>
      </div>

      <CouriersManager
        members={(links ?? []).flatMap((link) => {
          const courier = courierById.get(link.courier_id);
          if (!courier) return [];
          const person = profileById.get(courier.user_id);
          return [
            {
              linkId: link.id,
              courierId: courier.id,
              name: person?.full_name ?? person?.email ?? '—',
              email: person?.email ?? null,
              phone: courier.phone,
              vehicle: courier.vehicle,
              status: courier.status,
              deliveries: courier.deliveries_count,
              isActive: link.is_active,
            },
          ];
        })}
      />
    </div>
  );
}
