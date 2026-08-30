'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Receipt, Search, ShoppingBag, UserRound } from 'lucide-react';
import { useCartCount } from '@/lib/cart';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/** Cabecera solo de escritorio: en móvil manda la barra inferior. */
export function DesktopHeader({
  brand,
  isSignedIn,
}: {
  brand: { appName: string; logoUrl: string | null };
  isSignedIn: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const count = useCartCount();

  const links = [
    { href: '/', icon: Home, label: t.nav.home, exact: true },
    { href: '/search', icon: Search, label: t.common.search },
    { href: '/orders', icon: Receipt, label: t.nav.orders },
  ];

  return (
    <header className="sticky top-0 z-40 hidden border-b border-surface-line bg-white/95 backdrop-blur lg:block">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-8 py-3.5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          {brand.logoUrl ? (
            <Image src={brand.logoUrl} alt={brand.appName} width={32} height={32} className="rounded-lg" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
              {brand.appName.charAt(0)}
            </span>
          )}
          <span className="font-display text-lg font-bold text-ink">{brand.appName}</span>
        </Link>

        <nav className="flex flex-1 items-center gap-1">
          {links.map(({ href, icon: Icon, label, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                  active ? 'bg-brand-50 text-brand-700' : 'text-ink-400 hover:bg-surface-field hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/cart"
            className="relative flex h-10 w-10 items-center justify-center rounded-full bg-surface-field text-ink transition-colors hover:bg-surface-muted"
            aria-label={t.nav.cart}
          >
            <ShoppingBag className="h-[18px] w-[18px]" />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>

          {isSignedIn ? (
            <Link
              href="/account"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-field text-ink transition-colors hover:bg-surface-muted"
              aria-label={t.nav.profile}
            >
              <UserRound className="h-[18px] w-[18px]" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost text-xs">
                {t.auth.signIn}
              </Link>
              <Link href="/register" className="btn-primary text-xs">
                {t.auth.signUpCta}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
