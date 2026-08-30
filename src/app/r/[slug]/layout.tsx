import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { RestaurantProvider } from '@/components/storefront/restaurant-provider';
import { RestaurantNav } from '@/components/storefront/restaurant-nav';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return { title: 'Restaurante' };

  return {
    title: restaurant.name,
    description: restaurant.description ?? `Carta digital de ${restaurant.name}`,
    openGraph: {
      title: restaurant.name,
      description: restaurant.description ?? undefined,
      images: restaurant.cover_url ? [restaurant.cover_url] : undefined,
    },
  };
}

export default async function RestaurantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const tableCode = await getTableCodeFor(slug);

  return (
    <div className="mobile-shell flex flex-col">
      <RestaurantProvider
        slug={restaurant.slug}
        name={restaurant.name}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        tableCode={tableCode}
      />
      <div className="flex-1">{children}</div>
      <RestaurantNav slug={restaurant.slug} inTable={Boolean(tableCode)} />
    </div>
  );
}
