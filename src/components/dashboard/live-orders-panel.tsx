'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  Bell,
  Bike,
  CreditCard,
  Droplets,
  HelpCircle,
  Receipt,
  Smartphone,
  Store,
  UtensilsCrossed,
} from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { minutesSince, formatTime, cn } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type OrderRow = {
  id: string;
  code: string;
  type: Enums<'order_type'>;
  status: Enums<'order_status'>;
  paymentMethod: Enums<'payment_method'>;
  paymentStatus: Enums<'payment_status'>;
  totalCents: number;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  tableName: string | null;
  notes: string | null;
  createdAt: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    options: string[];
    notes: string | null;
    status: Enums<'order_item_status'>;
  }[];
};

export type CallRow = {
  id: string;
  type: Enums<'call_type'>;
  tableId: string;
  tableName: string | null;
  createdAt: string;
};

/** Siguiente estado natural del pedido según su modalidad. */
function nextStatus(order: OrderRow): Enums<'order_status'> | null {
  switch (order.status) {
    case 'pending':
      return 'confirmed';
    case 'confirmed':
      return 'preparing';
    case 'preparing':
      return 'ready';
    case 'ready':
      return order.type === 'delivery' ? 'delivering' : 'completed';
    case 'delivering':
      return 'completed';
    default:
      return null;
  }
}

const TYPE_ICON: Record<Enums<'order_type'>, typeof Bike> = {
  dine_in: UtensilsCrossed,
  delivery: Bike,
  pickup: Store,
};

const PAY_ICON: Record<Enums<'payment_method'>, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  tpv: Smartphone,
  stripe: CreditCard,
};

const CALL_ICON: Record<Enums<'call_type'>, typeof Bell> = {
  waiter: Bell,
  bill: Receipt,
  water: Droplets,
  help: HelpCircle,
};

export function LiveOrdersPanel({
  restaurantId,
  currency,
  currencyDecimals,
  initialOrders,
  initialCalls,
}: {
  restaurantId: string;
  currency: string;
  currencyDecimals: number;
  initialOrders: OrderRow[];
  initialCalls: CallRow[];
  staffRole?: Enums<'staff_role'>;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [orders, setOrders] = useState(initialOrders);
  const [calls, setCalls] = useState(initialCalls);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setOrders(initialOrders), [initialOrders]);
  useEffect(() => setCalls(initialCalls), [initialCalls]);

  /** Relee el pedido completo: el evento Realtime sólo trae la fila de orders. */
  const refetchOrder = useCallback(
    async (orderId: string) => {
      const supabase = createClient();
      const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (!order) return;

      const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
      let tableName: string | null = null;
      if (order.table_id) {
        const { data: table } = await supabase.from('tables').select('name').eq('id', order.table_id).maybeSingle();
        tableName = table?.name ?? null;
      }

      const row: OrderRow = {
        id: order.id,
        code: order.code,
        type: order.type,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        totalCents: order.total_cents,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        address: order.address,
        tableName,
        notes: order.notes,
        createdAt: order.created_at,
        items: (items ?? []).map((i) => ({
          id: i.id,
          name: i.name_snapshot,
          quantity: i.quantity,
          options: Array.isArray(i.options) ? (i.options as { name: string }[]).map((o) => o.name) : [],
          notes: i.notes,
          status: i.status,
        })),
      };

      setOrders((current) => {
        const open = ['pending', 'confirmed', 'preparing', 'ready', 'delivering'];
        const without = current.filter((o) => o.id !== row.id);
        return open.includes(row.status) ? [row, ...without] : without;
      });
    },
    [],
  );

  // Realtime: pedidos nuevos y avisos de mesa aparecen sin recargar.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`dashboard-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
          if (!id) return;
          if (payload.eventType === 'INSERT') toast(t.kitchen.newTicket, 'info');
          void refetchOrder(id);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${restaurantId}` },
        async (payload) => {
          const call = payload.new as {
            id: string;
            type: Enums<'call_type'>;
            table_id: string;
            created_at: string;
          };
          const { data: table } = await supabase.from('tables').select('name').eq('id', call.table_id).maybeSingle();
          setCalls((current) => [
            { id: call.id, type: call.type, tableId: call.table_id, tableName: table?.name ?? null, createdAt: call.created_at },
            ...current,
          ]);
          toast(`${t.table.calls}: ${table?.name ?? ''}`, 'info');
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurantId, refetchOrder, toast, t]);

  async function advance(order: OrderRow) {
    const target = nextStatus(order);
    if (!target) return;

    setBusy(order.id);
    const supabase = createClient();
    const { error } = await supabase.from('orders').update({ status: target }).eq('id', order.id);
    setBusy(null);

    if (error) {
      toast(t.common.error, 'error');
      return;
    }
    await refetchOrder(order.id);
  }

  async function cancel(order: OrderRow) {
    setBusy(order.id);
    const supabase = createClient();
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
    setBusy(null);
    if (error) {
      toast(t.common.error, 'error');
      return;
    }
    setOrders((current) => current.filter((o) => o.id !== order.id));
  }

  async function attend(call: CallRow) {
    const supabase = createClient();
    const { error } = await supabase
      .from('waiter_calls')
      .update({ status: 'attended', attended_at: new Date().toISOString() })
      .eq('id', call.id);
    if (error) {
      toast(t.common.error, 'error');
      return;
    }
    setCalls((current) => current.filter((c) => c.id !== call.id));
  }

  const ACTION_LABEL: Record<string, string> = {
    confirmed: t.dashboard.acceptOrder,
    preparing: t.dashboard.markPreparing,
    ready: t.dashboard.markReady,
    delivering: t.dashboard.markDelivering,
    completed: t.dashboard.markCompleted,
  };

  return (
    <div className="space-y-6">
      {calls.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-800">
            <Bell className="h-4 w-4" />
            {t.table.calls} ({calls.length})
          </h3>
          <ul className="flex flex-wrap gap-2">
            {calls.map((call) => {
              const Icon = CALL_ICON[call.type];
              return (
                <li key={call.id}>
                  <button
                    type="button"
                    onClick={() => attend(call)}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-xs font-bold text-ink-700 shadow-sm transition-colors hover:bg-amber-100"
                  >
                    <Icon className="h-4 w-4 text-amber-600" />
                    {call.tableName ?? '—'}
                    <span className="text-ink-300">
                      {interpolate(t.kitchen.elapsed, { n: minutesSince(call.createdAt) })}
                    </span>
                    <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] uppercase text-white">
                      {t.dashboard.attendCall}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {orders.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-7 w-7" />}
          title={t.dashboard.noActiveOrders}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orders.map((order) => {
            const TypeIcon = TYPE_ICON[order.type];
            const PayIcon = PAY_ICON[order.paymentMethod];
            const target = nextStatus(order);
            const elapsed = minutesSince(order.createdAt);

            return (
              <li key={order.id} className="flex flex-col rounded-2xl bg-white p-5 shadow-chip">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-bold text-ink">#{order.code}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-300">
                      <TypeIcon className="h-3.5 w-3.5" />
                      {order.tableName ?? (order.type === 'delivery' ? t.cart.delivery : t.cart.pickup)}
                      <span>·</span>
                      {formatTime(order.createdAt, locale)}
                    </p>
                  </div>
                  <Badge tone={elapsed > 25 ? 'danger' : elapsed > 15 ? 'warning' : 'brand'}>
                    {interpolate(t.kitchen.elapsed, { n: elapsed })}
                  </Badge>
                </div>

                <ul className="mt-4 flex-1 space-y-2">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex gap-2 text-sm">
                      <span className="font-bold text-brand">{item.quantity}×</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink-700">{item.name}</span>
                        {item.options.length > 0 && (
                          <span className="block text-xs text-ink-300">{item.options.join(' · ')}</span>
                        )}
                        {item.notes && (
                          <span className="block text-xs italic text-amber-700">“{item.notes}”</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {order.notes && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs italic text-amber-700">
                    {order.notes}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-surface-line pt-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-300">
                    <PayIcon className="h-3.5 w-3.5" />
                    {order.paymentMethod === 'cash'
                      ? t.checkout.cash
                      : order.paymentMethod === 'tpv'
                        ? t.checkout.tpv
                        : t.checkout.card}
                  </span>
                  <span className="font-display text-lg font-bold text-ink">
                    {formatMoney(order.totalCents, currency, currencyDecimals)}
                  </span>
                </div>

                <div className="mt-4 flex gap-2">
                  {target && (
                    <button
                      type="button"
                      onClick={() => advance(order)}
                      disabled={busy === order.id}
                      className={cn(
                        'btn flex-1 text-white',
                        order.status === 'pending' ? 'bg-state-success' : 'bg-brand',
                      )}
                    >
                      {ACTION_LABEL[target] ?? t.common.confirm}
                    </button>
                  )}
                  {order.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => cancel(order)}
                      disabled={busy === order.id}
                      className="btn border border-state-danger/40 text-state-danger"
                    >
                      {t.dashboard.rejectOrder}
                    </button>
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
