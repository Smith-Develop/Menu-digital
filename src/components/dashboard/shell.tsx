'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertTriangle,
  ChefHat,
  CreditCard,
  ExternalLink,
  BarChart3,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Image as ImageIcon,
  QrCode,
  Receipt,
  Settings,
  Shield,
  Ticket,
  Store,
  Truck,
  UsersRound,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canManageBilling, canManageMenu, canManageStaff } from '@/lib/auth-permissions';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useT } from '@/i18n/provider';
import { staffRoleLabel } from '@/lib/staff-roles';
import { cn, initials } from '@/lib/utils';
import type { Enums } from '@/types/database';

type Banner = { tone: 'danger' | 'warning'; message: string } | null;

export function DashboardShell({
  restaurant,
  user,
  staffRole,
  isSuperadmin,
  subscriptionBanner,
  children,
}: {
  restaurant: { id: string; name: string; slug: string; logoUrl: string | null; isOpen: boolean };
  user: { name: string; avatar: string | null };
  staffRole: Enums<'staff_role'>;
  isSuperadmin: boolean;
  subscriptionBanner: Banner;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/dashboard', icon: LayoutDashboard, label: t.dashboard.overview, exact: true, show: true },
    { href: '/dashboard/orders', icon: Receipt, label: t.dashboard.liveOrders, show: true },
    { href: '/dashboard/analytics', icon: BarChart3, label: t.analytics.title, show: canManageMenu(staffRole) },
    { href: '/dashboard/menu', icon: UtensilsCrossed, label: t.dashboard.menu, show: canManageMenu(staffRole) },
    { href: '/dashboard/tables', icon: QrCode, label: t.dashboard.tables, show: canManageMenu(staffRole) },
    { href: '/dashboard/banners', icon: ImageIcon, label: t.dashboard.banners, show: canManageMenu(staffRole) },
    { href: '/dashboard/coupons', icon: Ticket, label: t.coupon.coupons, show: canManageMenu(staffRole) },
    { href: '/dashboard/staff', icon: UsersRound, label: t.dashboard.staff, show: canManageStaff(staffRole) },
    { href: '/dashboard/couriers', icon: Truck, label: t.courier.couriers, show: canManageStaff(staffRole) },
    { href: '/dashboard/subscription', icon: CreditCard, label: t.dashboard.subscription, show: canManageBilling(staffRole) },
    { href: '/dashboard/settings', icon: Settings, label: t.dashboard.settings, show: canManageMenu(staffRole) },
  ].filter((l) => l.show);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-6">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
          {restaurant.logoUrl ? (
            <Image src={restaurant.logoUrl} alt={restaurant.name} fill sizes="44px" className="object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-300">
              <Store className="h-5 w-5" />
            </span>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink-700">{restaurant.name}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-300">
            <span className={cn('h-2 w-2 rounded-full', restaurant.isOpen ? 'bg-state-success' : 'bg-ink-200')} />
            {restaurant.isOpen ? t.storefront.open : t.storefront.closed}
          </p>
        </div>
      </div>

      <ul className="flex-1 space-y-1 px-3">
        {links.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
                  active ? 'bg-brand text-white' : 'text-ink-500 hover:bg-surface-field hover:text-ink',
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </Link>
            </li>
          );
        })}

        <li className="pt-3">
          <Link
            href="/kitchen"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <ChefHat className="h-[18px] w-[18px]" />
            {t.kitchen.title}
          </Link>
        </li>

        <li>
          <Link
            href={`/r/${restaurant.slug}`}
            target="_blank"
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-ink-500 transition-colors hover:bg-surface-field hover:text-ink"
          >
            <ExternalLink className="h-[18px] w-[18px]" />
            {t.storefront.viewMenu}
          </Link>
        </li>

        {isSuperadmin && (
          <li>
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-ink-500 transition-colors hover:bg-surface-field hover:text-ink"
            >
              <Shield className="h-[18px] w-[18px]" />
              {t.admin.title}
            </Link>
          </li>
        )}
      </ul>

      <div className="border-t border-surface-line px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-ink-700">{user.name}</p>
            <p className="text-[11px] uppercase tracking-wide text-ink-300">
              {staffRoleLabel(staffRole, t)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <LocaleSwitcher />
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-300 transition-colors hover:text-state-danger"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t.common.signOut}
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-surface-soft">
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-surface-line bg-white lg:block">
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <aside className="absolute inset-y-0 left-0 w-[264px] bg-white">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-5 icon-btn h-9 w-9"
              aria-label={t.common.close}
            >
              <X className="h-4 w-4" />
            </button>
            {nav}
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-surface-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="icon-btn" aria-label={t.nav.dashboard}>
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="font-display text-base font-bold text-ink-700">{restaurant.name}</span>
        </header>

        {subscriptionBanner && (
          <div
            className={cn(
              'flex items-center gap-3 px-5 py-3 text-sm font-semibold',
              subscriptionBanner.tone === 'danger'
                ? 'bg-red-50 text-red-700'
                : 'bg-amber-50 text-amber-700',
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{subscriptionBanner.message}</span>
            <Link href="/dashboard/subscription" className="shrink-0 underline">
              {t.subscription.renewNow}
            </Link>
          </div>
        )}

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
