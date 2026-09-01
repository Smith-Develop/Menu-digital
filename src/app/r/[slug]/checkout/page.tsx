import { notFound } from 'next/navigation';
import { getRestaurantBySlug, deliveryAllowed } from '@/lib/queries/public';
import { getTableSessionFor } from '@/lib/table-session';
import { getSessionProfile } from '@/lib/auth';
import { getCustomerLocation } from '@/lib/customer-location';
import { CheckoutView, type DeliverySlot } from '@/components/storefront/checkout-view';
import { createPublicSupabase } from '@/lib/supabase/server';
import type { Enums } from '@/types/database';

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { slug } = await params;
  const { type } = await searchParams;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const supabase = createPublicSupabase();
  const [table, profile, location, permiteReparto, { data: franjas }] = await Promise.all([
    getTableSessionFor(slug),
    getSessionProfile(),
    getCustomerLocation(),
    deliveryAllowed(restaurant.id),
    // Una semana por delante: más allá, la gente no sabe si estará en casa.
    supabase.rpc('available_delivery_slots', { p_restaurant_id: restaurant.id, p_days: 7 }),
  ]);

  const tableCode = table?.code ?? null;

  const requested = (['dine_in', 'delivery', 'pickup'] as const).includes(
    type as Enums<'order_type'>,
  )
    ? (type as Enums<'order_type'>)
    : tableCode
      ? 'dine_in'
      : permiteReparto
        ? 'delivery'
        : 'pickup';

  return (
    <CheckoutView
      slug={slug}
      orderType={requested}
      tableCode={tableCode}
      tableSession={table?.sessionId ?? null}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      deliveryFeeCents={restaurant.delivery_fee_cents}
      taxRate={Number(restaurant.tax_rate)}
      accepts={{
        cash: restaurant.accepts_cash,
        card: restaurant.accepts_card,
        tpv: restaurant.accepts_tpv,
      }}
      customer={{
        name: profile?.full_name ?? '',
        phone: profile?.phone ?? '',
        email: profile?.email ?? '',
      }}
      isSignedIn={Boolean(profile)}
      savedLocation={location ? { city: location.city, address: location.address } : null}
      slots={(franjas as unknown as DeliverySlot[]) ?? []}
    />
  );
}
