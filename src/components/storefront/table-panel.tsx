'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ConciergeBell, Droplets, HelpCircle, Receipt, UtensilsCrossed } from 'lucide-react';
import { ScreenHeader, Badge } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { formatTime } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import type { Enums } from '@/types/database';

type CallType = Enums<'call_type'>;

type OpenOrder = {
  token: string;
  code: string;
  status: Enums<'order_status'>;
  totalCents: number;
  createdAt: string;
};

/** Pantalla de mesa: avisos al camarero y estado de los pedidos en curso. */
export function TablePanel({
  slug,
  tableCode,
  tableName,
  restaurantName,
  currency,
  currencyDecimals,
  openOrders,
}: {
  slug: string;
  tableCode: string;
  tableName: string;
  restaurantName: string;
  currency: string;
  currencyDecimals: number;
  openOrders: OpenOrder[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [pending, setPending] = useState<CallType | null>(null);

  const actions: { type: CallType; icon: typeof ConciergeBell; label: string }[] = [
    { type: 'waiter', icon: ConciergeBell, label: t.table.callWaiter },
    { type: 'bill', icon: Receipt, label: t.table.callBill },
    { type: 'water', icon: Droplets, label: t.table.callWater },
    { type: 'help', icon: HelpCircle, label: t.table.callHelp },
  ];

  async function call(type: CallType) {
    setPending(type);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('call_waiter', {
        p_table_code: tableCode,
        p_type: type,
      });

      if (error) {
        toast(
          error.message.includes('CALL_ALREADY_PENDING') ? t.table.callPending : t.common.error,
          error.message.includes('CALL_ALREADY_PENDING') ? 'info' : 'error',
        );
        return;
      }
      toast(t.table.callWaiterSent, 'success');
    } catch {
      toast(t.common.error, 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="pb-8">
      <ScreenHeader title={t.table.calls} backHref={`/r/${slug}`} />

      <div className="px-5">
        <div className="rounded-2xl bg-ink px-5 py-6 text-white">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-white/60">
            {t.table.welcome}
          </p>
          <p className="mt-1 font-display text-xl font-bold">{restaurantName}</p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-bold">
            <UtensilsCrossed className="h-4 w-4" />
            {tableName}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {actions.map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              type="button"
              onClick={() => call(type)}
              disabled={pending !== null}
              className="flex flex-col items-center gap-2.5 rounded-2xl bg-surface-field px-3 py-6 text-center transition-colors hover:bg-brand-50 disabled:opacity-50"
            >
              <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand">
                <Icon className="h-6 w-6" />
                {pending === type && (
                  <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-brand" />
                )}
              </span>
              <span className="text-xs font-bold text-ink-600">{label}</span>
            </button>
          ))}
        </div>

        {openOrders.length > 0 && (
          <section className="mt-8">
            <h2 className="section-title mb-3">{t.table.myTableOrder}</h2>
            <ul className="space-y-3">
              {openOrders.map((order) => (
                <li key={order.token}>
                  <Link
                    href={`/order/${order.token}`}
                    className="flex items-center gap-3 rounded-2xl bg-surface-field px-4 py-4 transition-colors hover:bg-surface-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-700">#{order.code}</p>
                      <p className="mt-0.5 text-xs text-ink-300">
                        {formatTime(order.createdAt, locale)} ·{' '}
                        {formatMoney(order.totalCents, currency, currencyDecimals)}
                      </p>
                    </div>
                    <Badge tone={order.status === 'ready' ? 'success' : 'brand'}>
                      {t.order.status[order.status]}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
