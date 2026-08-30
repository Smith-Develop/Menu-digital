'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useCartCount } from '@/lib/cart';
import { useT } from '@/i18n/provider';
import { LocationPicker, type CityOption } from '@/components/storefront/location-picker';

/**
 * Cabecera de la portada.
 *
 * A la izquierda va el selector de ciudad y dirección —no el de idioma, que
 * vive en el perfil—: la ciudad decide qué restaurantes ve el cliente, así que
 * tiene que estar a un toque.
 */
export function TopBar({
  cities,
  location,
  cartHref = '/cart',
}: {
  cities: CityOption[];
  location: { city: string; citySlug: string; address: string | null } | null;
  cartHref?: string;
}) {
  const t = useT();
  const count = useCartCount();

  return (
    <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
      <LocationPicker cities={cities} current={location} />

      {/* En escritorio el logotipo y el carrito viven en DesktopHeader. */}
      <div className="flex items-center gap-2 lg:hidden">
        <Link
          href={cartHref}
          className="relative flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white transition-transform active:scale-95"
          aria-label={t.nav.cart}
        >
          <ShoppingBag className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
