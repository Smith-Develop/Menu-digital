import { getI18n } from '@/i18n';
import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { listCoupons } from '@/lib/queries/coupons';
import { CouponsManager } from '@/components/dashboard/coupons-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cupones' };

export default async function DashboardCouponsPage() {
  const { restaurant } = await requireSection('coupons');
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [coupons, { data: products }, { data: categories }] = await Promise.all([
    listCoupons(restaurant.id),
    supabase.from('products').select('id, name').eq('restaurant_id', restaurant.id).order('name'),
    supabase.from('categories').select('id, name').eq('restaurant_id', restaurant.id).order('name'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.coupon.coupons}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.coupon.ownHint}</p>
      </div>

      <CouponsManager
        coupons={coupons}
        products={products ?? []}
        categories={categories ?? []}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
      />
    </div>
  );
}
