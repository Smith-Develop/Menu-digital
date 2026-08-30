import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getSessionProfile } from '@/lib/auth';
import { CartView } from '@/components/storefront/cart-view';

export const dynamic = 'force-dynamic';

export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const profile = await getSessionProfile();

  return (
    <CartView
      slug={slug}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      deliveryFeeCents={restaurant.delivery_fee_cents}
      minOrderCents={restaurant.min_order_cents}
      taxRate={Number(restaurant.tax_rate)}
      isSignedIn={Boolean(profile)}
      allows={{
        dineIn: restaurant.dinein_enabled,
        delivery: restaurant.delivery_enabled,
        pickup: restaurant.pickup_enabled,
      }}
    />
  );
}
