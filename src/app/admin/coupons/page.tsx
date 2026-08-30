import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { listCoupons } from '@/lib/queries/coupons';
import { CouponsManager } from '@/components/dashboard/coupons-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cupones' };

export default async function AdminCouponsPage() {
  await requireSuperadmin();
  const { t } = await getI18n();

  // Los cupones de plataforma valen en cualquier restaurante, así que no se
  // pueden acotar a platos o categorías de un local concreto.
  const coupons = await listCoupons(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.coupon.coupons}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.coupon.globalHint}</p>
      </div>

      <CouponsManager
        coupons={coupons}
        products={[]}
        categories={[]}
        currency="EUR"
        currencyDecimals={2}
        asGlobal
      />
    </div>
  );
}
