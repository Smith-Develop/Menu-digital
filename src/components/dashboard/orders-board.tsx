'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bike, Receipt, Store, UtensilsCrossed } from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/misc';
import {
  LiveOrdersPanel,
  type OrderRow,
  type CallRow,
} from '@/components/dashboard/live-orders-panel';
import { formatMoney } from '@/lib/money';
import type { SoundSettings } from '@/lib/sounds';
import { formatDateTime } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

const TYPE_ICON: Record<Enums<'order_type'>, typeof Bike> = {
  dine_in: UtensilsCrossed,
  delivery: Bike,
  pickup: Store,
};

export function OrdersBoard({
  restaurantId,
  currency,
  currencyDecimals,
  sounds,
  calls,
  orders,
  showHistory,
}: {
  restaurantId: string;
  currency: string;
  currencyDecimals: number;
  sounds: SoundSettings;
  calls: CallRow[];
  orders: OrderRow[];
  showHistory: boolean;
  staffRole?: Enums<'staff_role'>;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <div className="flex gap-1 rounded-xl bg-surface-field p-1 sm:w-fit">
        <TabLink href="/dashboard/orders" active={!showHistory} label={t.order.ongoing} />
        <TabLink href="/dashboard/orders?view=history" active={showHistory} label={t.order.history} />
      </div>

      {!showHistory ? (
        <LiveOrdersPanel
          restaurantId={restaurantId}
          currency={currency}
          currencyDecimals={currencyDecimals}
          sounds={sounds}
          initialOrders={orders}
          initialCalls={calls}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-7 w-7" />}
          title={t.order.noOrders}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-chip">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-surface-line text-left text-xs uppercase tracking-wide text-ink-300">
                <th className="px-5 py-3 font-bold">{t.order.orderCode}</th>
                <th className="px-5 py-3 font-bold">{t.common.date}</th>
                <th className="px-5 py-3 font-bold">{t.cart.orderType}</th>
                <th className="px-5 py-3 font-bold">{t.checkout.paymentMethod}</th>
                <th className="px-5 py-3 font-bold">{t.order.deliveredBy}</th>
                <th className="px-5 py-3 font-bold">{t.common.status}</th>
                <th className="px-5 py-3 text-right font-bold">{t.common.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-line">
              {orders.map((order) => {
                const TypeIcon = TYPE_ICON[order.type];
                const open = expanded === order.id;
                return (
                  <>
                    <tr
                      key={order.id}
                      onClick={() => setExpanded(open ? null : order.id)}
                      className="cursor-pointer transition-colors hover:bg-surface-soft"
                    >
                      <td className="px-5 py-3.5 font-bold text-ink-700">#{order.code}</td>
                      <td className="px-5 py-3.5 text-ink-400">
                        {formatDateTime(order.createdAt, locale)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-ink-500">
                          <TypeIcon className="h-3.5 w-3.5" />
                          {order.tableName ??
                            (order.type === 'delivery' ? t.cart.delivery : t.cart.pickup)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-ink-400">
                        {order.paymentMethod === 'cash'
                          ? t.checkout.cash
                          : order.paymentMethod === 'tpv'
                            ? t.checkout.tpv
                            : t.checkout.card}
                      </td>
                      <td className="px-5 py-3.5 text-ink-400">
                        {order.courierName ? (
                          <span className="block font-semibold text-ink-600">
                            {order.courierName}
                          </span>
                        ) : order.type === 'delivery' ? (
                          <span className="text-ink-300">—</span>
                        ) : (
                          <span className="text-ink-300">{t.order.atTheVenue}</span>
                        )}
                        {order.completedAt && (
                          <span className="block text-xs">
                            {formatDateTime(order.completedAt, locale)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone={order.status === 'cancelled' ? 'danger' : 'success'}>
                          {t.order.status[order.status]}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5 text-right font-bold text-ink">
                        {formatMoney(order.totalCents, currency, currencyDecimals)}
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${order.id}-detail`} className="bg-surface-soft">
                        <td colSpan={7} className="px-5 py-4">
                          <ul className="space-y-1.5">
                            {order.items.map((item) => (
                              <li key={item.id} className="flex gap-2 text-sm">
                                <span className="font-bold text-brand">{item.quantity}×</span>
                                <span className="text-ink-600">{item.name}</span>
                                {item.options.length > 0 && (
                                  <span className="text-xs text-ink-300">
                                    ({item.options.join(' · ')})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {(order.customerName || order.address) && (
                            <p className="mt-3 text-xs text-ink-300">
                              {[order.customerName, order.customerPhone, order.address]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-lg px-4 py-2 text-sm font-bold transition-colors',
        active ? 'bg-white text-ink shadow-sm' : 'text-ink-400',
      )}
    >
      {label}
    </Link>
  );
}
