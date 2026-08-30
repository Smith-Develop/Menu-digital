import Link from 'next/link';
import {
  ChefHat,
  ChevronRight,
  CreditCard,
  Heart,
  LayoutDashboard,
  Receipt,
  Settings,
  Shield,
  UserRound,
} from 'lucide-react';
import { getI18n } from '@/i18n';
import { getSessionProfile, getStaffContext } from '@/lib/auth';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { initials } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi perfil' };

export default async function AccountPage() {
  const { t } = await getI18n();
  const profile = await getSessionProfile();
  const staff = profile ? await getStaffContext() : null;

  if (!profile) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
        <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-ink-300">
          <UserRound className="h-7 w-7" />
        </span>
        <p className="font-display text-lg font-bold text-ink-700">{t.auth.signIn}</p>
        <p className="mt-1.5 text-sm text-ink-300">{t.auth.signInSubtitle}</p>
        <div className="mt-7 flex w-full max-w-xs flex-col gap-3">
          <Link href="/login?next=/account" className="btn-primary">
            {t.auth.signIn}
          </Link>
          <Link href="/register" className="btn-ghost">
            {t.auth.signUp}
          </Link>
        </div>
        <div className="mt-8 text-ink-300">
          <LocaleSwitcher />
        </div>
      </div>
    );
  }

  const groups: { href: string; icon: typeof Receipt; label: string }[][] = [
    [
      { href: '/orders', icon: Receipt, label: t.order.myOrders },
      { href: '/search', icon: Heart, label: t.storefront.featured },
    ],
    ...(staff
      ? [
          [
            { href: '/dashboard', icon: LayoutDashboard, label: t.nav.dashboard },
            { href: '/kitchen', icon: ChefHat, label: t.kitchen.title },
            { href: '/dashboard/subscription', icon: CreditCard, label: t.dashboard.subscription },
            { href: '/dashboard/settings', icon: Settings, label: t.dashboard.settings },
          ],
        ]
      : []),
    ...(profile.role === 'superadmin'
      ? [[{ href: '/admin', icon: Shield, label: t.admin.title }]]
      : []),
  ];

  return (
    <div className="px-5 pb-8 pt-6">
      <h1 className="mb-6 font-display text-xl font-bold text-ink-700">{t.nav.profile}</h1>

      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 font-display text-lg font-bold text-brand-700">
          {initials(profile.full_name ?? profile.email)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-ink">
            {profile.full_name ?? '—'}
          </p>
          <p className="truncate text-sm text-ink-300">{profile.email}</p>
        </div>
      </div>

      <div className="mt-7 space-y-4">
        {groups.map((group, index) => (
          <ul key={index} className="overflow-hidden rounded-2xl bg-surface-field">
            {group.map(({ href, icon: Icon, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-muted"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-sm font-semibold text-ink-600">{label}</span>
                  <ChevronRight className="h-4 w-4 text-ink-200" />
                </Link>
              </li>
            ))}
          </ul>
        ))}

        <div className="flex items-center justify-between rounded-2xl bg-surface-field px-4 py-4">
          <span className="text-sm font-semibold text-ink-600">{t.common.language}</span>
          <LocaleSwitcher />
        </div>

        <SignOutButton label={t.common.signOut} />
      </div>
    </div>
  );
}
