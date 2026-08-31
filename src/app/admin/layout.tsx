import { requireSuperadmin } from '@/lib/auth';
import { AdminNav } from '@/components/admin/admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireSuperadmin();

  return (
    <div className="min-h-dvh bg-surface-soft">
      <AdminNav userName={profile.full_name ?? profile.email ?? ''} />

      <div className="lg:pl-[264px]">
        <main className="mx-auto max-w-6xl px-5 py-7">{children}</main>
      </div>
    </div>
  );
}
