'use client';

import Link from 'next/link';
import { Menu, MapPin, ShoppingBag } from 'lucide-react';
import { useCartCount } from '@/lib/cart';
import { useT } from '@/i18n/provider';
import { LocaleSwitcher } from '@/components/locale-switcher';

/**
 * Cabecera de la portada: menú, ubicación de entrega y carrito con contador.
 * Reproduce el bloque "Top" de Home_01.
 */
export function TopBar({ location, cartHref = '/cart' }: { location?: string; cartHref?: string }) {
  const t = useT();
  const count = useCartCount();

  return (
    <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
      <LocaleSwitcher
        trigger={
          <span className="icon-btn" aria-label={t.common.language}>
            <Menu className="h-5 w-5" />
          </span>
        }
      />

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">
          {t.storefront.deliverTo}
        </p>
        <p className="flex items-center gap-1 truncate text-sm text-ink-400">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {location ?? '—'}
        </p>
      </div>

      <Link
        href={cartHref}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white"
        aria-label={t.nav.cart}
      >
        <ShoppingBag className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Link>
    </header>
  );
}
