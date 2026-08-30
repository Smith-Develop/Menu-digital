import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { LocaleSwitcher } from '@/components/locale-switcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink">
      <header className="flex items-center justify-between px-6 pb-10 pt-10">
        <Link href="/" className="flex items-center gap-2.5 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand">
            <UtensilsCrossed className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold">Menu Digital</span>
        </Link>
        <div className="text-white/70">
          <LocaleSwitcher />
        </div>
      </header>

      <main className="flex-1 rounded-t-[32px] bg-white px-6 pb-10 pt-9">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
