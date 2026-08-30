import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { CartView } from '@/components/storefront/cart-view';

export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const tableCode = await getTableCodeFor(slug);

  return (
    <CartView
      slug={slug}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      deliveryFeeCents={restaurant.delivery_fee_cents}
      minOrderCents={restaurant.min_order_cents}
      taxRate={Number(restaurant.tax_rate)}
      inTable={Boolean(tableCode)}
      allows={{
        dineIn: restaurant.dinein_enabled,
        delivery: restaurant.delivery_enabled,
        pickup: restaurant.pickup_enabled,
      }}
    />
  );
}
