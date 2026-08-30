import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { RestaurantProvider } from '@/components/storefront/restaurant-provider';
import { RestaurantNav } from '@/components/storefront/restaurant-nav';
import { brandCssVariables } from '@/lib/brand';
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
    // Cada restaurante pinta su tienda con sus propios colores: las variables
    // sobrescriben aquí las de la marca global sin tocar el resto de la app.
    <div
      className="mobile-shell flex flex-col lg:max-w-2xl lg:shadow-chip"
      style={
        brandCssVariables({
          primaryColor: restaurant.primary_color,
          accentColor: restaurant.accent_color,
          textColor: restaurant.text_color,
        }) as React.CSSProperties
      }
    >
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
