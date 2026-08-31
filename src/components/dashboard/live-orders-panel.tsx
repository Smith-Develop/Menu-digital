'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useRef} from 'react';
import {
  Banknote,
  Bell,
  Bike,
  CreditCard,
  Droplets,
  HelpCircle,
  Receipt,
  Printer,
  Smartphone,
  Truck,
  Store,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { playSound, unlockAudio, type SoundSettings } from '@/lib/sounds';
import { updateOrderStatus, updateOrderPaymentStatus } from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { minutesSince, formatTime, cn } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import { usePrint } from '@/components/dashboard/print/print-provider';
import type { TicketOrder } from '@/components/dashboard/print/ticket';
import { mapOrderRow } from '@/lib/queries/orders';
import { CourierPicker } from '@/components/dashboard/courier-picker';
import { ConfirmDialog } from '@/components/ui/sheet';
import type { Enums } from '@/types/database';

export type OrderRow = {
  id: string;
  code: string;
  type: Enums<'order_type'>;
  status: Enums<'order_status'>;
  paymentMethod: Enums<'payment_method'>;
  paymentStatus: Enums<'payment_status'>;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  couponCode: string | null;
  deliveryFeeCents: number;
  taxCents: number;
  tipCents: number;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  addressNotes: string | null;
  tableName: string | null;
  courierId: string | null;
  courierName: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    lineTotalCents: number;
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

/**
 * Un pedido solo puede anularse mientras la cocina no lo haya empezado.
 * A partir de "preparando" hay comida hecha y la cancelación deja de ser
 * una decisión de pantalla.
 */
function canCancel(status: Enums<'order_status'>): boolean {
  return status === 'pending' || status === 'confirmed';
}

/** Convierte la fila del panel en el ticket que se imprime. */
function toTicket(order: OrderRow, currency: string, decimals: number): TicketOrder {
  return {
    code: order.code,
    type: order.type,
    createdAt: order.createdAt,
    tableName: order.tableName,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: [order.address, order.addressNotes].filter(Boolean).join(' · ') || null,
    notes: order.notes,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    currency,
    currencyDecimals: decimals,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    couponCode: order.couponCode,
    deliveryFeeCents: order.deliveryFeeCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents,
    totalCents: order.totalCents,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents,
      options: item.options,
      notes: item.notes,
    })),
  };
}

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
  sounds,
  initialOrders,
  initialCalls,
}: {
  restaurantId: string;
  currency: string;
  currencyDecimals: number;
  sounds: SoundSettings;
  initialOrders: OrderRow[];
  initialCalls: CallRow[];
  staffRole?: Enums<'staff_role'>;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const { print, printIfAuto } = usePrint();
  const [orders, setOrders] = useState(initialOrders);

  // Los navegadores no dejan sonar nada hasta que alguien toca la página, así
  // que el primer clic en cualquier sitio del panel habilita el audio.
  useEffect(() => {
    const habilitar = () => unlockAudio();
    window.addEventListener('pointerdown', habilitar, { once: true });
    return () => window.removeEventListener('pointerdown', habilitar);
  }, []);

  const notify = useCallback(
    (kind: 'newOrder' | 'orderReady' | 'waiterCall') => {
      if (!sounds.enabled) return;
      playSound(sounds[kind], sounds.volume);
    },
    [sounds],
  );
  const [calls, setCalls] = useState(initialCalls);
  const [busy, setBusy] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<OrderRow | null>(null);
  const [chargeFor, setChargeFor] = useState<OrderRow | null>(null);
  const vistos = useRef(new Set(initialCalls.map((c) => c.id)));

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

      let courierName: string | null = null;
      if (order.courier_id) {
        const { data: courier } = await supabase
          .from('couriers')
          .select('user_id')
          .eq('id', order.courier_id)
          .maybeSingle();
        if (courier) {
          const { data: person } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', courier.user_id)
            .maybeSingle();
          courierName = person?.full_name ?? person?.email ?? null;
        }
      }

      const row = mapOrderRow(order, items ?? [], tableName, courierName);

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
          if (payload.eventType === 'INSERT') {
            toast(t.kitchen.newTicket, 'info');
            notify('newOrder');
          }
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
  }, [restaurantId, refetchOrder, toast, t, notify]);

  /**
   * Relectura periódica de los avisos de mesa.
   *
   * El aviso llega normalmente por el canal en directo, pero ese canal depende
   * de un servicio aparte que puede caerse o quedarse atrás sin que nadie se
   * entere: cuando eso pasa, el aviso de una mesa que reclama camarero no suena
   * y nadie va. Releer cada pocos segundos cuesta una consulta pequeña y
   * convierte el directo en una mejora de latencia en vez de un requisito.
   *
   * Los identificadores ya vistos evitan que un aviso suene dos veces cuando
   * ambos caminos funcionan.
   */
  useEffect(() => {
    const supabase = createClient();
    let vivo = true;

    async function releer() {
      const { data } = await supabase
        .from('waiter_calls')
        .select('id, type, table_id, created_at, tables(name)')
        .eq('restaurant_id', restaurantId)
        .is('attended_at', null)
        .order('created_at', { ascending: false });

      if (!vivo || !data) return;

      const frescos: CallRow[] = data.map((row) => ({
        id: row.id,
        type: row.type,
        tableId: row.table_id,
        tableName: (row as { tables?: { name?: string } | null }).tables?.name ?? null,
        createdAt: row.created_at,
      }));

      // La comparación va fuera del actualizador de estado: React puede
      // invocarlo más de una vez con el mismo valor, y el aviso sonaría
      // repetido. La lista de vistos vive en una referencia, que no provoca
      // re-render ni se reinicia entre ciclos.
      // El sonido lo emite el aviso a pantalla completa del marco del panel;
      // aquí sólo se refresca la lista para no avisar dos veces del mismo.
      vistos.current = new Set(frescos.map((c) => c.id));
      setCalls(frescos);
    }

    const temporizador = setInterval(releer, 15_000);
    return () => {
      vivo = false;
      clearInterval(temporizador);
    };
  }, [restaurantId, notify]);

  async function advance(order: OrderRow) {
    const target = nextStatus(order);
    if (!target) return;

    // Un pedido de mesa no puede darse por servido sin cobrarlo. Cerrarlo antes
    // lo deja fuera de los pedidos activos pero dentro de la cuenta de la mesa,
    // que sólo se vacía al cobrar: por eso el comensal veía ahí lo que pidió
    // hace días. Se pregunta antes de cerrar, y si aún no ha pagado, no se
    // cierra.
    if (target === 'completed' && order.type === 'dine_in' && order.paymentStatus !== 'paid') {
      setChargeFor(order);
      return;
    }

    await applyStatus(order, target);
  }

  async function applyStatus(order: OrderRow, target: Enums<'order_status'>) {
    setBusy(order.id);
    // Vía acción de servidor: es la que dispara el aviso al móvil del cliente.
    const result = await updateOrderStatus(order.id, target);
    setBusy(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }

    // Al aceptar sale la comanda para cocina, si la impresión automática
    // está activada en los ajustes del restaurante.
    if (target === 'confirmed') {
      printIfAuto(toTicket(order, currency, currencyDecimals));
    }

    await refetchOrder(order.id);

    // Cerrar un pedido cambia ingresos y platos más vendidos: las métricas
    // las calcula el servidor, así que hay que pedirle que las recalcule.
    if (target === 'completed') router.refresh();
  }

  /** Cobrar deja la mesa libre: el pedido sale de la cuenta del comensal. */
  async function markPaid(order: OrderRow): Promise<boolean> {
    setBusy(order.id);
    const result = await updateOrderPaymentStatus(order.id, 'paid');
    setBusy(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return false;
    }
    toast(t.dashboard.markedPaid, 'success');
    await refetchOrder(order.id);
    router.refresh();
    return true;
  }

  /** Cobrar y cerrar de una vez, que es lo que ocurre al servir en mesa. */
  async function chargeAndClose() {
    const order = chargeFor;
    if (!order) return;
    setChargeFor(null);
    if (await markPaid(order)) await applyStatus(order, 'completed');
  }

  async function cancel(order: OrderRow) {
    setBusy(order.id);
    const result = await updateOrderStatus(order.id, 'cancelled');
    setBusy(null);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setOrders((current) => current.filter((o) => o.id !== order.id));
    router.refresh();
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

      <ConfirmDialog
        open={chargeFor !== null}
        onClose={() => setChargeFor(null)}
        onConfirm={chargeAndClose}
        title={t.dashboard.chargeBeforeClosing}
        message={
          chargeFor
            ? `${t.dashboard.chargeQuestion} (#${chargeFor.code} · ${formatMoney(chargeFor.totalCents, currency, currencyDecimals)})`
            : ''
        }
        confirmLabel={t.dashboard.alreadyCharged}
        cancelLabel={t.dashboard.notChargedYet}
        loading={busy === chargeFor?.id}
      />

      <CourierPicker
        open={assignFor !== null}
        onClose={() => setAssignFor(null)}
        restaurantId={restaurantId}
        orderId={assignFor?.id ?? null}
        orderCode={assignFor?.code ?? null}
        onAssigned={() => {
          if (assignFor) void refetchOrder(assignFor.id);
          router.refresh();
        }}
      />

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

                {order.courierName && (
                  <button
                    type="button"
                    onClick={() => setAssignFor(order)}
                    className="mt-3 flex w-full items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-left text-xs text-brand-700 transition-colors hover:bg-brand-100"
                  >
                    <Truck className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{order.courierName}</span>
                    <span className="shrink-0 opacity-70">{t.courier.changeCourier}</span>
                  </button>
                )}

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

                <div className="mt-4 space-y-2">
                  <div className="flex gap-2">
                    {target === 'delivering' ? (
                      // Salir a reparto exige decidir quién lo lleva.
                      <button
                        type="button"
                        onClick={() => setAssignFor(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 bg-brand text-brand-contrast"
                      >
                        <Truck className="h-4 w-4" />
                        {t.courier.sendCourier}
                      </button>
                    ) : (
                      target && (
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
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => print(toTicket(order, currency, currencyDecimals))}
                      title={t.dashboard.printTicket}
                      aria-label={t.dashboard.printTicket}
                      className="btn border border-surface-line text-ink-500 hover:bg-surface-field"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    {order.type === 'dine_in' && order.paymentStatus !== 'paid' && (
                      <button
                        type="button"
                        onClick={() => markPaid(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      >
                        {t.dashboard.markPaid}
                      </button>
                    )}

                    {canCancel(order.status) && (
                      <button
                        type="button"
                        onClick={() => cancel(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-state-danger/40 text-state-danger hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4" />
                        {t.dashboard.cancelOrder}
                      </button>
                    )}
                  </div>

                  {!canCancel(order.status) && order.status !== 'completed' && (
                    <p className="text-center text-[11px] text-ink-300">
                      {t.dashboard.cannotCancelInKitchen}
                    </p>
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
