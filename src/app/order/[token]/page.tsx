import { notFound } from 'next/navigation';
import { createPublicSupabase } from '@/lib/supabase/server';
import { OrderTracker, type TrackedOrder } from '@/components/storefront/order-tracker';

export const dynamic = 'force-dynamic';

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = createPublicSupabase();
  const { data, error } = await supabase.rpc('get_order_by_token', { p_token: token });

  if (error || !data) notFound();

  return <OrderTracker order={data as unknown as TrackedOrder} token={token} />;
}
