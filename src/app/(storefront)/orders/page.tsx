import Image from 'next/image';
import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { EmptyState, Badge } from '@/components/ui/misc';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import type { Enums } from '@/types/database';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mis pedidos' };

const ONGOING: Enums<'order_status'>[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'served',
  'delivering',
];

export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { t, locale } = await getI18n();
  const { view } = await searchParams;
  const history = view === 'history';

  const profile = await getSessionProfile();

  if (!profile) {
    return (
      <div className="px-5 pt-6">
        <h1 className="font-display text-xl font-bold text-ink-700">{t.order.myOrders}</h1>
        <EmptyState
          icon={<Receipt className="h-7 w-7" />}
          title={t.order.noOrders}
          description={t.auth.signInSubtitle}
          action={
            <Link href="/login?next=/orders" className="btn-primary">
              {t.auth.signIn}
            </Link>
          }
        />
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', profile.id)
    .in('status', history ? ['completed', 'cancelled'] : ONGOING)
    .order('created_at', { ascending: false })
    .limit(50);

  const restaurantIds = [...new Set((orders ?? []).map((o) => o.restaurant_id))];
  const { data: restaurants } = restaurantIds.length
    ? await supabase.from('restaurants').select('id, name, slug, logo_url, currency_decimals').in('id', restaurantIds)
    : { data: [] };
  const byId = new Map((restaurants ?? []).map((r) => [r.id, r]));

  return (
    <div className="px-5 pb-8 pt-6">
      <h1 className="mb-4 font-display text-xl font-bold text-ink-700">{t.order.myOrders}</h1>

      <div className="mb-5 flex gap-1 rounded-xl bg-surface-field p-1">
        <Link
          href="/orders"
          className={`flex-1 rounded-lg py-2.5 text-center text-sm font-bold transition-colors ${
            !history ? 'bg-white text-brand shadow-sm' : 'text-ink-400'
          }`}
        >
          {t.order.ongoing}
        </Link>
        <Link
          href="/orders?view=history"
          className={`flex-1 rounded-lg py-2.5 text-center text-sm font-bold transition-colors ${
            history ? 'bg-white text-brand shadow-sm' : 'text-ink-400'
          }`}
        >
          {t.order.history}
        </Link>
      </div>

      {(orders ?? []).length === 0 ? (
        <EmptyState icon={<Receipt className="h-7 w-7" />} title={t.order.noOrders} />
      ) : (
        <ul className="space-y-4">
          {(orders ?? []).map((order) => {
            const restaurant = byId.get(order.restaurant_id);
            return (
              <li key={order.id} className="rounded-2xl bg-white p-4 shadow-chip">
                <div className="flex items-center gap-3">
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                    {restaurant?.logo_url && (
                      <Image
                        src={restaurant.logo_url}
                        alt={restaurant.name}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-700">
                      {restaurant?.name ?? '—'}
                    </p>
                    <p className="text-xs text-ink-300">
                      #{order.code} · {formatDateTime(order.created_at, locale)}
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-ink">
                      {formatMoney(order.total_cents, order.currency, restaurant?.currency_decimals)}
                    </p>
                  </div>
                  <Badge
                    tone={
                      order.status === 'cancelled'
                        ? 'danger'
                        : order.status === 'completed'
                          ? 'success'
                          : 'brand'
                    }
                  >
                    {t.order.status[order.status]}
                  </Badge>
                </div>

                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/order/${order.public_token}`}
                    className="btn-primary flex-1 text-xs"
                  >
                    {history ? t.common.seeAll : t.checkout.trackOrder}
                  </Link>
                  {restaurant && (
                    <Link href={`/r/${restaurant.slug}`} className="btn-ghost flex-1 text-xs">
                      {t.order.reorder}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
