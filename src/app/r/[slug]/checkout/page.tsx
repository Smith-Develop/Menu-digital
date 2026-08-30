import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { getSessionProfile } from '@/lib/auth';
import { CheckoutView } from '@/components/storefront/checkout-view';
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

  const [tableCode, profile] = await Promise.all([getTableCodeFor(slug), getSessionProfile()]);

  const requested = (['dine_in', 'delivery', 'pickup'] as const).includes(
    type as Enums<'order_type'>,
  )
    ? (type as Enums<'order_type'>)
    : tableCode
      ? 'dine_in'
      : 'delivery';

  return (
    <CheckoutView
      slug={slug}
      orderType={requested}
      tableCode={tableCode}
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
    />
  );
}
