import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { CouriersAdmin } from '@/components/admin/couriers-admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Repartidores' };

export default async function AdminCouriersPage() {
  await requireSuperadmin();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const { data: couriers } = await supabase
    .from('couriers')
    .select('*')
    .order('created_at', { ascending: false });

  const userIds = (couriers ?? []).map((c) => c.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', userIds)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Restaurantes para los que trabaja cada repartidor: es lo que distingue a un
  // repartidor de la plataforma de uno atado a un solo local.
  const courierIds = (couriers ?? []).map((c) => c.id);
  const { data: links } = courierIds.length
    ? await supabase
        .from('restaurant_couriers')
        .select('courier_id, restaurants(name)')
        .in('courier_id', courierIds)
    : { data: [] };

  const restaurantsByCourier = new Map<string, string[]>();
  for (const link of links ?? []) {
    const name = (link as { restaurants?: { name?: string } }).restaurants?.name;
    if (!name) continue;
    const list = restaurantsByCourier.get(link.courier_id) ?? [];
    list.push(name);
    restaurantsByCourier.set(link.courier_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.courier.couriers}</h1>
        <p className="mt-1 text-sm text-ink-300">{(couriers ?? []).length}</p>
      </div>

      <CouriersAdmin
        couriers={(couriers ?? []).map((courier) => {
          const person = byId.get(courier.user_id);
          return {
            id: courier.id,
            userId: courier.user_id,
            name: person?.full_name ?? person?.email ?? '—',
            email: person?.email ?? null,
            avatar: person?.avatar_url ?? null,
            phone: courier.phone,
            vehicle: courier.vehicle,
            status: courier.status,
            isActive: courier.is_active,
            deliveries: courier.deliveries_count,
            rating: courier.rating,
            city: courier.city,
            restaurants: restaurantsByCourier.get(courier.id) ?? [],
          };
        })}
      />
    </div>
  );
}
