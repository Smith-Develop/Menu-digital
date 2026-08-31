'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Bell,
  Menu,
  Shield,
  Bike,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Package,
  Palette,
  UserCog,
  Store,
  Ticket,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * Navegación del panel de superadministración.
 *
 * Barra lateral, como la del panel de restaurante: las secciones ya no caben
 * cómodamente en una fila y en una lateral se leen de un vistazo. En pantallas
 * estrechas se repliega tras el botón de menú.
 */
export function AdminNav({ userName }: { userName: string }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/admin', icon: LayoutDashboard, label: t.dashboard.overview, exact: true },
    { href: '/admin/restaurants', icon: Store, label: t.admin.restaurants },
    { href: '/admin/plans', icon: Package, label: t.admin.plans },
    { href: '/admin/categories', icon: LayoutGrid, label: t.catalog.title },
    { href: '/admin/couriers', icon: Bike, label: t.courier.couriers },
    { href: '/admin/coupons', icon: Ticket, label: t.coupon.coupons },
    { href: '/admin/branding', icon: Palette, label: t.admin.branding },
    { href: '/admin/notifications', icon: Bell, label: t.admin.notifications },
    { href: '/admin/account', icon: UserCog, label: t.admin.myAccount },
  ];

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const contenido = (
    <div className="flex h-full flex-col">
      <Link href="/admin" className="flex items-center gap-2.5 px-5 py-5 text-ink">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-brand-contrast">
          <Shield className="h-4 w-4" />
        </span>
        <span className="font-display text-base font-bold">{t.admin.title}</span>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {links.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors',
                active ? 'bg-ink text-white' : 'text-ink-400 hover:bg-surface-field hover:text-ink',
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-surface-line px-4 py-4">
        <p className="truncate text-sm font-bold text-ink-700">{userName}</p>
        <div className="mt-2 flex items-center justify-between">
          <LocaleSwitcher />
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs font-bold text-ink-300 transition-colors hover:text-state-danger"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t.common.signOut}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-surface-line bg-white lg:block">
        {contenido}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/50"
          />
          <aside className="absolute inset-y-0 left-0 w-[264px] bg-white">{contenido}</aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-surface-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.common.menu}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-field text-ink"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-display text-base font-bold text-ink">{t.admin.title}</span>
      </header>
    </>
  );
}
