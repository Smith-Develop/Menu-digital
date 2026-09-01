import { notFound } from 'next/navigation';
import { requireStaffContext } from '@/lib/auth';
import { canAccessSection } from '@/lib/auth-permissions';
import { hasModule } from '@/lib/business-modules';
import { createServerSupabase } from '@/lib/supabase/server';
import { DeliverySlots, type Slot } from '@/components/dashboard/delivery-slots';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Franjas de entrega' };

export default async function SlotsPage() {
  const { restaurant, staffRole } = await requireStaffContext();

  if (!canAccessSection('slots', staffRole) || !hasModule(restaurant.business_type, 'slots')) {
    notFound();
  }

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('delivery_slots')
    .select('id, weekday, starts_at, ends_at, capacity, is_active')
    .eq('restaurant_id', restaurant.id)
    .order('weekday')
    .order('starts_at');

  return <DeliverySlots slots={(data ?? []) as Slot[]} />;
}
