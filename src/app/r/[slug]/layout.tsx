import { notFound } from 'next/navigation';
import { getRestaurantBySlug } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { getBrowseMode } from '@/lib/store-context';
import { CartProvider, RestaurantSync } from '@/components/storefront/cart-provider';
import { RestaurantNav } from '@/components/storefront/restaurant-nav';
import { StoreHeader } from '@/components/storefront/store-header';
import { brandCssVariables } from '@/lib/brand';
import { getStaffContext } from '@/lib/auth';
import { canAccessSection } from '@/lib/auth-permissions';
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
  // Quien trabaja en la sala de este restaurante vuelve a su panel, no al
  // escaparate: entra aquí a tomar comandas, no a mirar la competencia.
  const staff = await getStaffContext();
  const atiendeAqui =
    staff?.restaurant.id === restaurant.id && canAccessSection('floor', staff.staffRole);

  const inTable = Boolean(tableCode);

  return (
    // Cada restaurante pinta su tienda con sus propios colores: las variables
    // sobrescriben aquí las de la marca global sin tocar el resto de la app.
    /*
     * Alto exacto de la ventana, no mínimo: así el scroll vive dentro de <main>
     * y cada pantalla puede quedarse quieta si le conviene. Restar píxeles a
     * ojo para la cabecera y la barra inferior no funcionaba, porque ambas
     * cambian de alto entre móvil y escritorio.
     */
    <div
      className="flex h-dvh flex-col overflow-hidden bg-surface-soft"
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
          staffHome={atiendeAqui ? '/dashboard/floor' : null}
        />

        {/*
          En móvil, la columna estrecha del diseño. A partir de `lg` la tienda
          ocupa el ancho de la página igual que el escaparate: abrir la carta en
          un ordenador y ver una tira de 480 px en medio de la pantalla se veía
          roto.
        */}
        {/*
          El contenedor no scrollea: reparte el alto y deja que cada pantalla
          decida. La carta se desplaza entera; el carrito y los avisos se quedan
          fijos y mueven solo su lista, para que el botón de acción no se vaya
          nunca por debajo del borde.
        */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full min-w-0 max-w-[480px] flex-1 flex-col overflow-hidden bg-white lg:max-w-6xl lg:bg-transparent">
            {children}
          </div>
        </main>

        <RestaurantNav slug={restaurant.slug} inTable={inTable} />
      </CartProvider>
    </div>
  );
}
