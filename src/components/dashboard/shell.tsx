'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CalendarClock,
  ChefHat,
  CreditCard,
  ExternalLink,
  BarChart3,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  PackageCheck,
  Image as ImageIcon,
  QrCode,
  Users,
  Receipt,
  Settings,
  Shield,
  Ticket,
  Store,
  Truck,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canAccessSection, type DashboardSection } from '@/lib/auth-permissions';
import { hasModule } from '@/lib/business-modules';
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
  restaurant: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    isOpen: boolean;
    businessType: Enums<'business_type'>;
  };
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
  const cabecera = useRef<HTMLElement>(null);

  // Para entrar hacen falta las dos cosas: que el rol tenga la llave y que el
  // negocio tenga la puerta. Un supermercado sin mesas no enseña la sala por
  // mucho que quien mire sea el dueño.
  const puede = (seccion: DashboardSection) =>
    canAccessSection(seccion, staffRole) && hasModule(restaurant.businessType, seccion);


  const links = [
    // El menú enseña exactamente lo que cada rol puede abrir: la misma tabla que
    // usan las páginas para dejar entrar, así que nunca ofrecen sitios cerrados.
    { href: '/dashboard', icon: LayoutDashboard, label: t.dashboard.overview, exact: true, show: true },
    // El nombre depende de si hay sala que atender: prometer "sala" a quien no
    // tiene mesas es prometer una pantalla que no existe.
    {
      href: '/dashboard/orders',
      icon: Receipt,
      label: hasModule(restaurant.businessType, 'floor')
        ? t.dashboard.floorAndOrders
        : t.nav.orders,
      show: puede('orders'),
    },
    // Preparar la compra sustituye a la pantalla de cocina, que no se abre
    // desde aquí sino desde su propia ruta.
    { href: '/dashboard/picking', icon: PackageCheck, label: t.picking.title, show: puede('picking') },
    // La caja va junto a los pedidos: se abre al empezar el turno y se cierra
    // al acabarlo, que es el mismo momento en que se mira la sala.
    // Tomar pedidos por teléfono va antes que la caja del turno: es lo que se
    // usa a cada rato, y la caja sólo al abrir y al cerrar.
    { href: '/dashboard/pos', icon: Calculator, label: t.pos.title, show: puede('pos') },
    { href: '/dashboard/cash', icon: Wallet, label: t.cash.title, show: puede('cash') },
    { href: '/dashboard/menu', icon: UtensilsCrossed, label: t.dashboard.menu, show: puede('menu') },
    { href: '/dashboard/tables', icon: QrCode, label: t.dashboard.tables, show: puede('tables') },
    { href: '/dashboard/slots', icon: CalendarClock, label: t.slots.title, show: puede('slots') },
    { href: '/dashboard/banners', icon: ImageIcon, label: t.dashboard.banners, show: puede('banners') },
    { href: '/dashboard/coupons', icon: Ticket, label: t.coupon.coupons, show: puede('coupons') },
    { href: '/dashboard/staff', icon: UsersRound, label: t.dashboard.staff, show: puede('staff') },
    { href: '/dashboard/couriers', icon: Truck, label: t.courier.couriers, show: puede('couriers') },
    { href: '/dashboard/subscription', icon: CreditCard, label: t.dashboard.subscription, show: puede('subscription') },
    { href: '/dashboard/settings', icon: Settings, label: t.dashboard.settings, show: puede('settings') },
  ].filter((l) => l.show);

  /**
   * Publica el alto de la cabecera móvil como variable de CSS.
   *
   * Las barras pegajosas de las pantallas de dentro necesitan saber dónde
   * empieza el espacio libre. Medirla es preferible a escribir un número: en
   * escritorio la cabecera no existe y el alto pasa a cero solo, y si algún día
   * cambia el relleno no hay que acordarse de tocar nada más.
   */
  useEffect(() => {
    const el = cabecera.current;
    if (!el) return;
    const medir = () =>
      document.documentElement.style.setProperty('--dash-header-h', `${el.offsetHeight}px`);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => {
      observador.disconnect();
      document.documentElement.style.removeProperty('--dash-header-h');
    };
  }, []);

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

        {/* La pantalla de cocina va aparte del menú porque no es una sección
            del panel, pero se rige por lo mismo: quien puede trabajarla, y un
            negocio que tenga cocina. */}
        {puede('kitchen') && (
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
        )}

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
        <header
          ref={cabecera}
          className="sticky top-0 z-30 flex items-center gap-3 border-b border-surface-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden"
        >
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
