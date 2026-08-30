import { redirect } from 'next/navigation';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { getCourierProfile } from '@/lib/courier';
import { createServerSupabase } from '@/lib/supabase/server';
import { CourierOnboarding } from '@/components/courier/courier-onboarding';
import { CourierDashboard, type DeliveryOrder } from '@/components/courier/courier-dashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Repartos' };

type Stats = { active: number; today: number; total: number; restaurants: number };

export default async function CourierPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login?next=/courier');

  const { t } = await getI18n();
  const courier = await getCourierProfile();

  // Sin ficha de repartidor, lo primero es crearla.
  if (!courier) return <CourierOnboarding />;

  const supabase = await createServerSupabase();

  const [{ data: statsRaw }, { data: links }, { data: orders }] = await Promise.all([
    supabase.rpc('courier_stats'),
    supabase
      .from('restaurant_couriers')
      .select('id, restaurant_id, is_active')
      .eq('courier_id', courier.id)
      .eq('is_active', true),
    // RLS ya limita esto a: sus pedidos asignados + los libres de sus restaurantes.
    supabase
      .from('orders')
      .select('*')
      .in('status', ['ready', 'delivering'])
      .eq('type', 'delivery')
      .order('created_at', { ascending: true })
      .limit(40),
  ]);

  const stats = (statsRaw as unknown as Stats | null) ?? {
    active: 0,
    today: 0,
    total: 0,
    restaurants: 0,
  };

  const restaurantIds = [...new Set((orders ?? []).map((o) => o.restaurant_id))];
  const linkedIds = (links ?? []).map((l) => l.restaurant_id);
  const allIds = [...new Set([...restaurantIds, ...linkedIds])];

  const { data: restaurants } = allIds.length
    ? await supabase
        .from('restaurants')
        .select('id, name, slug, address, phone, logo_url, currency, currency_decimals, lat, lng')
        .in('id', allIds)
    : { data: [] };

  const byId = new Map((restaurants ?? []).map((r) => [r.id, r]));

  const mapped: DeliveryOrder[] = (orders ?? []).map((order) => {
    const restaurant = byId.get(order.restaurant_id);
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      totalCents: order.total_cents,
      currency: order.currency,
      currencyDecimals: restaurant?.currency_decimals ?? 2,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      address: order.address,
      addressNotes: order.address_notes,
      notes: order.notes,
      createdAt: order.created_at,
      isMine: order.courier_id === courier.id,
      restaurant: {
        name: restaurant?.name ?? '—',
        address: restaurant?.address ?? null,
        phone: restaurant?.phone ?? null,
        logoUrl: restaurant?.logo_url ?? null,
      },
    };
  });

  return (
    <CourierDashboard
      courier={{
        id: courier.id,
        status: courier.status,
        vehicle: courier.vehicle,
        phone: courier.phone,
        city: courier.city,
      }}
      name={profile.full_name ?? profile.email ?? t.courier.title}
      stats={stats}
      orders={mapped}
      restaurants={(links ?? []).map((link) => ({
        linkId: link.id,
        name: byId.get(link.restaurant_id)?.name ?? '—',
        logoUrl: byId.get(link.restaurant_id)?.logo_url ?? null,
      }))}
    />
  );
}
