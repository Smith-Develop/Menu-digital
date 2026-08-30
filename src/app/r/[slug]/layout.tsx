import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { getBrowseMode } from '@/lib/store-context';
import { CartProvider, RestaurantSync } from '@/components/storefront/cart-provider';
import { RestaurantNav } from '@/components/storefront/restaurant-nav';
import { StoreHeader } from '@/components/storefront/store-header';
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

  const [tableCode, browseMode] = await Promise.all([getTableCodeFor(slug), getBrowseMode()]);
  const inTable = Boolean(tableCode);

  return (
    // Cada restaurante pinta su tienda con sus propios colores: las variables
    // sobrescriben aquí las de la marca global sin tocar el resto de la app.
    <div
      className="flex min-h-dvh flex-col bg-surface-soft"
      style={
        brandCssVariables({
          primaryColor: restaurant.primary_color,
          accentColor: restaurant.accent_color,
          textColor: restaurant.text_color,
        }) as React.CSSProperties
      }
    >
      <CartProvider inTable={inTable} tableCode={tableCode}>
        <RestaurantSync
          slug={restaurant.slug}
          name={restaurant.name}
          currency={restaurant.currency}
          currencyDecimals={restaurant.currency_decimals}
          tableCode={tableCode}
        />

        <StoreHeader
          slug={restaurant.slug}
          name={restaurant.name}
          logoUrl={restaurant.logo_url}
          browseMode={browseMode}
          inTable={inTable}
        />

        <div className="mx-auto w-full max-w-[480px] flex-1 bg-white lg:max-w-3xl lg:rounded-sheet lg:shadow-chip">
          {children}
        </div>

        <RestaurantNav slug={restaurant.slug} inTable={inTable} />
      </CartProvider>
    </div>
  );
}
