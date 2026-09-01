import { notFound } from 'next/navigation';
import { getRestaurantBySlug, deliveryAllowed } from '@/lib/queries/public';
import { getSessionProfile } from '@/lib/auth';
import { CartView } from '@/components/storefront/cart-view';

export const dynamic = 'force-dynamic';

export default async function CartPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  // El reparto depende del interruptor del local y del plan contratado. Sin
  // esta comprobación el cliente elegía "a domicilio" y el pedido se rechazaba
  // al final, que es la peor forma de enterarse.
  const [profile, permiteReparto] = await Promise.all([
    getSessionProfile(),
    deliveryAllowed(restaurant.id),
  ]);

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
        delivery: restaurant.delivery_enabled && permiteReparto,
        pickup: restaurant.pickup_enabled,
      }}
    />
  );
}
