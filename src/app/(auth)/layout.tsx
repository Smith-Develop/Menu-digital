import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { AuthBackdrop } from '@/components/auth/auth-backdrop';
import { getAuthScreens } from '@/lib/auth-screens';
import { getBrand } from '@/lib/brand';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [screens, brand] = await Promise.all([getAuthScreens(), getBrand()]);

  return (
    <div className="relative flex min-h-dvh flex-col bg-ink">
      <AuthBackdrop login={screens.loginImageUrl} register={screens.registerImageUrl} />

      <header className="relative flex items-center justify-between px-6 pb-10 pt-10">
        <Link href="/" className="flex items-center gap-2.5 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand">
            <UtensilsCrossed className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold">{brand.appName}</span>
        </Link>
        <div className="text-white/70">
          <LocaleSwitcher />
        </div>
      </header>

      <main className="relative flex-1 rounded-t-[32px] bg-white px-6 pb-10 pt-9">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
