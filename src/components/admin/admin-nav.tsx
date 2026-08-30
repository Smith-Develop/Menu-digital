'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, LayoutDashboard, LogOut, Package, Palette, Store } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export function AdminNav({ userName }: { userName: string }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    { href: '/admin', icon: LayoutDashboard, label: t.dashboard.overview, exact: true },
    { href: '/admin/restaurants', icon: Store, label: t.admin.restaurants },
    { href: '/admin/plans', icon: Package, label: t.admin.plans },
    { href: '/admin/branding', icon: Palette, label: t.admin.branding },
    { href: '/admin/notifications', icon: Bell, label: t.admin.notifications },
  ];

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex gap-1">
        {links.map(({ href, icon: Icon, label, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                active ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="ml-2 flex items-center gap-3 border-l border-white/15 pl-3 text-white/60">
        <LocaleSwitcher />
        <span className="hidden text-xs font-semibold md:inline">{userName}</span>
        <button
          type="button"
          onClick={signOut}
          aria-label={t.common.signOut}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
