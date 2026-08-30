'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, ConciergeBell, Receipt, ShoppingBag } from 'lucide-react';
import { useCartCount } from '@/lib/cart';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/** Navegación acotada al restaurante: nunca saca al cliente de su carta. */
export function RestaurantNav({ slug, inTable }: { slug: string; inTable: boolean }) {
  const pathname = usePathname();
  const t = useT();
  const count = useCartCount();

  const items = [
    { href: `/r/${slug}`, icon: BookOpen, label: t.nav.menu, exact: true },
    { href: `/r/${slug}/cart`, icon: ShoppingBag, label: t.nav.cart, badge: count },
    ...(inTable
      ? [{ href: `/r/${slug}/table`, icon: ConciergeBell, label: t.table.calls }]
      : [{ href: '/orders', icon: Receipt, label: t.nav.orders }]),
  ];

  return (
    <nav
      className="sticky bottom-0 z-40 mt-auto border-t border-surface-line bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="flex items-stretch justify-around">
        {items.map(({ href, icon: Icon, label, badge, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition-colors',
                  active ? 'text-brand' : 'text-ink-200 hover:text-ink-400',
                )}
              >
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.9} />
                  {typeof badge === 'number' && badge > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
