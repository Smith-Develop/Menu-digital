'use client';

import Link from 'next/link';
import { Home, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import Image from 'next/image';
import { useCartCount } from '@/lib/cart';
import { useActiveCart } from '@/components/storefront/cart-provider';
import { useT } from '@/i18n/provider';
import type { BrowseMode } from '@/lib/store-context';

/**
 * Cabecera de la tienda de un restaurante.
 *
 * Quien llegó navegando por Yumi tiene a la izquierda el acceso al escaparate;
 * quien abrió el enlace del restaurante —o escaneó el QR de una mesa— ve el
 * logotipo del local, porque para él la aplicación es ese restaurante y sacarlo
 * a la competencia no tendría sentido.
 */
export function StoreHeader({
  slug,
  name,
  logoUrl,
  browseMode,
  inTable,
}: {
  slug: string;
  name: string;
  logoUrl: string | null;
  browseMode: BrowseMode;
  inTable: boolean;
}) {
  const t = useT();
  const count = useCartCount(useActiveCart());
  const canGoHome = browseMode === 'marketplace' && !inTable;

  return (
    <header className="sticky top-0 z-40 border-b border-surface-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-3 px-4 py-3 lg:max-w-6xl lg:px-8">
        {canGoHome ? (
          <Link
            href="/"
            className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface-field px-4 text-ink transition-colors hover:bg-surface-muted"
            aria-label={t.storefront.backToMarketplace}
          >
            <Home className="h-[18px] w-[18px]" />
            <span className="hidden text-sm font-bold sm:inline">
              {t.storefront.backToMarketplace}
            </span>
          </Link>
        ) : (
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
            {logoUrl ? (
              <Image src={logoUrl} alt={name} fill sizes="40px" className="object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink-300">
                <UtensilsCrossed className="h-4 w-4" />
              </span>
            )}
          </span>
        )}

        <span className="min-w-0 flex-1" />

        <Link
          href={`/r/${slug}/cart`}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-transform active:scale-95"
          aria-label={t.nav.cart}
        >
          <ShoppingBag className="h-[18px] w-[18px]" />
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
