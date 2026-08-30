import Link from 'next/link';
import { Shield } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth';
import { getI18n } from '@/i18n';
import { AdminNav } from '@/components/admin/admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireSuperadmin();
  const { t } = await getI18n();

  return (
    <div className="min-h-dvh bg-surface-soft">
      <header className="border-b border-surface-line bg-ink">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-4">
          <Link href="/admin" className="flex items-center gap-2.5 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand">
              <Shield className="h-4 w-4" />
            </span>
            <span className="font-display text-base font-bold">{t.admin.title}</span>
          </Link>
          <div className="flex-1" />
          <AdminNav userName={profile.full_name ?? profile.email ?? ''} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-7">{children}</main>
    </div>
  );
}
