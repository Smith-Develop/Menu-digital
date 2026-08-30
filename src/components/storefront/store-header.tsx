'use client';

import Link from 'next/link';
import { Home, UtensilsCrossed } from 'lucide-react';
import Image from 'next/image';
import { useT } from '@/i18n/provider';
import type { BrowseMode } from '@/lib/store-context';

/**
 * Cabecera de la tienda de un restaurante.
 *
 * A la derecha, donde antes estaba el carrito, hay un acceso a la portada. El
 * carrito no se pierde: vive en la barra inferior, siempre a la vista, y
 * tenerlo dos veces en pantalla sólo restaba sitio.
 *
 * A dónde lleva ese acceso depende de por dónde entró la persona. Quien llegó
 * navegando por Yumi vuelve al escaparate; quien abrió el enlace del
 * restaurante —o escaneó el QR de una mesa— va a la portada de ese local,
 * porque para él la aplicación es ese restaurante y sacarlo a la competencia no
 * tendría sentido.
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
  const canGoHome = browseMode === 'marketplace' && !inTable;

  return (
    <header className="sticky top-0 z-40 border-b border-surface-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-3 px-4 py-3 lg:max-w-6xl lg:px-8">
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
          {logoUrl ? (
            <Image src={logoUrl} alt={name} fill sizes="40px" className="object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-300">
              <UtensilsCrossed className="h-4 w-4" />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1" />

        <Link
          href={canGoHome ? '/' : `/r/${slug}`}
          className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-white transition-transform active:scale-95"
          aria-label={canGoHome ? t.storefront.backToMarketplace : t.nav.home}
        >
          <Home className="h-[18px] w-[18px]" />
          <span className="hidden text-sm font-bold sm:inline">
            {canGoHome ? t.storefront.backToMarketplace : t.nav.home}
          </span>
        </Link>
      </div>
    </header>
  );
}
