'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ConciergeBell,
  Droplets,
  HelpCircle,
  Receipt,
  ShoppingBag,
  UtensilsCrossed,
} from 'lucide-react';
import { ScreenHeader, Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { formatTime } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import type { Enums } from '@/types/database';

type CallType = Enums<'call_type'>;

export type TableBill = {
  table: { name: string; code: string };
  restaurant: { name: string; slug: string; currency: string; currency_decimals: number };
  orders: {
    id: string;
    token: string;
    code: string;
    status: Enums<'order_status'>;
    payment_status: Enums<'payment_status'>;
    total_cents: number;
    discount_cents: number;
    coupon_code: string | null;
    created_at: string;
    items: { name: string; quantity: number; line_total_cents: number }[];
  }[];
  total_cents: number;
};

/**
 * Pantalla de mesa: avisos al camarero y cuenta abierta.
 *
 * Los pedidos siguen aquí después de servirse; solo desaparecen cuando el
 * restaurante los marca como cobrados. Así el comensal ve en todo momento lo
 * que lleva consumido y lo que va a pagar.
 */
export function TablePanel({
  slug,
  tableCode,
  tableName,
  restaurantName,
  currency,
  currencyDecimals,
  bill,
}: {
  slug: string;
  tableCode: string;
  tableName: string;
  restaurantName: string;
  currency: string;
  currencyDecimals: number;
  bill: TableBill | null;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState<CallType | null>(null);

  const orders = bill?.orders ?? [];
  const total = bill?.total_cents ?? 0;

  // La cuenta cambia cuando la cocina avanza o el camarero cobra.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`table-${tableCode}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () =>
        router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tableCode, router]);

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
        const pendingCall = error.message.includes('CALL_ALREADY_PENDING');
        toast(pendingCall ? t.table.callPending : t.common.error, pendingCall ? 'info' : 'error');
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
    /*
     * Igual que el carrito: alto fijo y scroll interno, para que el botón de
     * pedir la cuenta no se vaya nunca por debajo del borde de la pantalla.
     */
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t.table.calls} backHref={`/r/${slug}`} className="shrink-0" />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="rounded-2xl bg-ink px-5 py-6 text-white animate-fade-up">
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
              className="flex flex-col items-center gap-2.5 rounded-2xl bg-surface-field px-3 py-6 text-center transition-all duration-200 hover:bg-brand-50 active:scale-[0.97] disabled:opacity-50"
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

        {/* Cuenta abierta */}
        <section className="mt-8">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="section-title">{t.table.myTableOrder}</h2>
            {total > 0 && (
              <span className="font-display text-lg font-bold text-ink">
                {formatMoney(total, currency, currencyDecimals)}
              </span>
            )}
          </div>

          {orders.length === 0 ? (
            <EmptyState
              icon={<ShoppingBag className="h-7 w-7" />}
              title={t.table.noOpenOrders}
              description={t.table.noOpenOrdersHint}
              action={
                <Link href={`/r/${slug}`} className="btn-primary">
                  {t.cart.startOrder}
                </Link>
              }
              className="rounded-2xl bg-surface-field"
            />
          ) : (
            <>
              <ul className="space-y-3">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="rounded-2xl bg-surface-field p-4 transition-shadow hover:shadow-chip animate-fade-up"
                  >
                    <Link href={`/order/${order.token}`} className="block">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-ink-700">#{order.code}</p>
                          <p className="mt-0.5 text-xs text-ink-300">
                            {formatTime(order.created_at, locale)}
                          </p>
                        </div>
                        <Badge
                          tone={
                            order.status === 'completed'
                              ? 'success'
                              : order.status === 'ready'
                                ? 'accent'
                                : 'brand'
                          }
                        >
                          {order.status === 'completed'
                            ? t.table.servedAtTable
                            : t.order.status[order.status]}
                        </Badge>
                      </div>

                      <ul className="mt-3 space-y-1">
                        {order.items.map((item, index) => (
                          <li
                            key={`${order.id}-${index}`}
                            className="flex justify-between gap-3 text-xs text-ink-500"
                          >
                            <span className="truncate">
                              <span className="font-bold text-brand">{item.quantity}×</span>{' '}
                              {item.name}
                            </span>
                            <span className="shrink-0 font-semibold text-ink-600">
                              {formatMoney(item.line_total_cents, currency, currencyDecimals)}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {order.coupon_code && order.discount_cents > 0 && (
                        <p className="mt-2 text-xs font-semibold text-emerald-700">
                          {order.coupon_code} · −
                          {formatMoney(order.discount_cents, currency, currencyDecimals)}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between rounded-2xl bg-ink px-5 py-4 text-white">
                <span className="text-xs font-bold uppercase tracking-wide text-white/60">
                  {t.table.billTotal}
                </span>
                <span className="font-display text-xl font-bold">
                  {formatMoney(total, currency, currencyDecimals)}
                </span>
              </div>

              <p className="mt-3 text-center text-xs text-ink-300">{t.table.paidWhenSettled}</p>
            </>
          )}
        </section>
      </div>

      {orders.length > 0 && (
        <div
          className="shrink-0 border-t border-surface-line bg-white px-5 pt-4"
          style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
        >
          <button
            type="button"
            onClick={() => call('bill')}
            disabled={pending !== null}
            className="btn-primary w-full"
          >
            <Receipt className="h-4 w-4" />
            {t.table.callBill}
          </button>
        </div>
      )}
    </div>
  );
}
