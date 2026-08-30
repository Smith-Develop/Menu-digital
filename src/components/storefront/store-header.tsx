'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { useCartCount } from '@/lib/cart';
import { useActiveCart } from '@/components/storefront/cart-provider';
import { useT } from '@/i18n/provider';
import type { BrowseMode } from '@/lib/store-context';

/**
 * Cabecera de la tienda de un restaurante.
 *
 * Solo ofrece volver al escaparate a quien llegó navegando por Yumi. Quien
 * abrió el enlace del restaurante —o escaneó el QR de una mesa— se queda dentro
 * de esa tienda: para él la aplicación es ese restaurante y sacarlo a ver la
 * competencia no tendría sentido.
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
  const canGoBack = browseMode === 'marketplace' && !inTable;

  return (
    <header className="sticky top-0 z-40 border-b border-surface-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-3 px-4 py-3 lg:max-w-3xl">
        {canGoBack ? (
          <Link
            href="/"
            className="icon-btn h-10 w-10 shrink-0 transition-transform active:scale-95"
            aria-label={t.storefront.backToMarketplace}
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
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

        <Link href={`/r/${slug}`} className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-bold text-ink">{name}</span>
          {canGoBack && (
            <span className="block truncate text-[11px] text-ink-300">
              {t.storefront.backToMarketplace}
            </span>
          )}
        </Link>

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
