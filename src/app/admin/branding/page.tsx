import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { getBrand } from '@/lib/brand';
import { BrandingForm } from '@/components/admin/branding-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marca' };

export default async function BrandingPage() {
  await requireSuperadmin();
  const [{ t }, brand] = await Promise.all([getI18n(), getBrand()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.branding}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.admin.brandingHint}</p>
      </div>

      <BrandingForm initial={brand} />
    </div>
  );
}
