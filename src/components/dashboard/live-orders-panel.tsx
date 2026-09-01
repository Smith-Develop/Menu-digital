'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useRef} from 'react';
import {
  Banknote,
  Bell,
  Bike,
  CreditCard,
  Droplets,
  FileText,
  HelpCircle,
  Receipt,
  Printer,
  Smartphone,
  Truck,
  Percent,
  Store,
  Undo2,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { playSound, unlockAudio, type SoundSettings } from '@/lib/sounds';
import {
  updateOrderStatus,
  cancelOrder,
  markPickedUp,
  addOrderPayment,
  refundOrder,
  voidOrderItem,
  applyManualDiscount,
  failDelivery,
  issueFiscalDocument,
} from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { formatTime, cn } from '@/lib/utils';
import { Transcurrido } from '@/components/dashboard/elapsed';
import { useI18n, interpolate } from '@/i18n/provider';
import { usePrint } from '@/components/dashboard/print/print-provider';
import type { TicketOrder } from '@/components/dashboard/print/ticket';
import { mapOrderRow } from '@/lib/queries/orders';
import { CourierPicker } from '@/components/dashboard/courier-picker';
import {
  ChargeDialog,
  RefundDialog,
  DiscountDialog,
  ReasonDialog,
  InvoiceDialog,
  MOTIVOS_QUITAR,
  MOTIVOS_FALLIDA,
  type Method,
} from '@/components/dashboard/money-dialogs';
import { canChargeOrders, canCancelOrders } from '@/lib/auth-permissions';
import type { Enums } from '@/types/database';

export type OrderRow = {
  id: string;
  code: string;
  type: Enums<'order_type'>;
  status: Enums<'order_status'>;
  paymentMethod: Enums<'payment_method'>;
  paymentStatus: Enums<'payment_status'>;
  totalCents: number;
  /** Neto cobrado según el libro de movimientos: cobros menos devoluciones. */
  paidCents: number;
  refundedCents: number;
  subtotalCents: number;
  discountCents: number;
  manualDiscountCents: number;
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
  deliveryFailedAt: string | null;
  deliveryFailedReason: string | null;
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
    voidedAt: string | null;
    voidReason: string | null;
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
const MOTIVOS_ANULAR = ['customer', 'unreachable', 'outOfStock', 'mistake', 'duplicate', 'other'] as const;

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
      // En mesa hay un paso más: llevar el plato no es cerrar la cuenta.
      return order.type === 'delivery' ? 'delivering' : order.type === 'dine_in' ? 'served' : 'completed';
    case 'served':
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
  staffRole = 'owner',
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
  // Cobrar y cerrar son dos cosas: a veces se cobra un pedido que sigue en
  // marcha (la mesa paga antes de irse) y a veces el cobro es el último paso.
  const [chargeCloses, setChargeCloses] = useState(false);
  const [cancelFor, setCancelFor] = useState<OrderRow | null>(null);
  const [refundFor, setRefundFor] = useState<OrderRow | null>(null);
  const [discountFor, setDiscountFor] = useState<OrderRow | null>(null);
  const [failFor, setFailFor] = useState<OrderRow | null>(null);
  const [voidItem, setVoidItem] = useState<{ order: OrderRow; itemId: string; name: string } | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<OrderRow | null>(null);
  const vistos = useRef(new Set(initialCalls.map((c) => c.id)));

  const puedeCobrar = canChargeOrders(staffRole);
  // Anular, devolver, invitar y quitar líneas son la misma atribución: todo lo
  // que reduce la venta responde ante quien dirige el local.
  const puedeAnular = canCancelOrders(staffRole);

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
        const open = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'delivering'];
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

    // Ningún pedido se cierra sin cobrar, sea del tipo que sea. Antes esta
    // pregunta sólo saltaba en mesa, así que un pedido de recogida —o uno de
    // domicilio que repartía el propio local— llegaba a "completado" con el
    // cobro en pendiente y desaparecía del panel sin que nadie lo revisara.
    //
    // Los que lleva un repartidor son la excepción: allí el cobro y la entrega
    // ocurren a la vez, en la puerta del cliente, y los registra él.
    if (target === 'completed' && order.paymentStatus !== 'paid' && !order.courierId) {
      setChargeCloses(true);
      setChargeFor(order);
      return;
    }

    await applyStatus(order, target);
  }

  async function entregarAlRepartidor(order: OrderRow) {
    setBusy(order.id);
    const result = await markPickedUp(order.id);
    setBusy(null);

    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    await refetchOrder(order.id);
    router.refresh();
  }

  async function applyStatus(order: OrderRow, target: Enums<'order_status'>) {
    setBusy(order.id);
    // Vía acción de servidor: es la que dispara el aviso al móvil del cliente.
    const result = await updateOrderStatus(order.id, target);
    setBusy(null);

    if (!result.ok) {
      // La base rechaza cerrar lo que nadie ha cobrado. Si se llega aquí es
      // porque el pedido se cobró en otra pantalla mientras tanto: se ofrece
      // el cobro en vez de un error que no dice qué hacer.
      if (result.error === 'PAYMENT_REQUIRED') {
        toast(t.dashboard.paymentRequired, 'error');
        setChargeCloses(true);
        setChargeFor(order);
        return;
      }
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

  /**
   * Registra el cobro con el medio realmente empleado.
   *
   * Cobrar deja además la mesa libre: el pedido sale de la cuenta del comensal.
   */
  /**
   * Confirmación del diálogo de cobro.
   *
   * Un cobro parcial —la cuenta dividida— no cierra el pedido aunque se hubiera
   * llegado aquí para cerrarlo: queda a medias hasta que entre el resto.
   */
  async function confirmCharge(method: Method, amountCents: number | null, note: string | null) {
    const order = chargeFor;
    const cerrar = chargeCloses;
    if (!order) return;
    setChargeFor(null);

    setBusy(order.id);
    const result = await addOrderPayment(order.id, method, amountCents, note);
    setBusy(null);

    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }

    if (result.data.fullyPaid) {
      toast(t.dashboard.markedPaid, 'success');
    } else {
      toast(
        `${t.dashboard.dueNow}: ${formatMoney(result.data.dueCents, currency, currencyDecimals)}`,
        'info',
      );
    }

    await refetchOrder(order.id);
    router.refresh();

    if (cerrar && result.data.fullyPaid) await applyStatus(order, 'completed');
  }

  async function confirmRefund(reason: string, amountCents: number | null, method: Method) {
    const order = refundFor;
    if (!order) return;
    setRefundFor(null);

    setBusy(order.id);
    const result = await refundOrder(order.id, reason, amountCents, method);
    setBusy(null);

    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }
    toast(
      `${t.dashboard.refundDone}: ${formatMoney(result.data.refundedCents, currency, currencyDecimals)}`,
      'success',
    );
    await refetchOrder(order.id);
    router.refresh();
  }

  async function confirmDiscount(cents: number, reason: string) {
    const order = discountFor;
    if (!order) return;
    setDiscountFor(null);

    setBusy(order.id);
    const result = await applyManualDiscount(order.id, cents, reason);
    setBusy(null);

    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }
    toast(t.dashboard.discountDone, 'success');
    await refetchOrder(order.id);
    router.refresh();
  }

  async function confirmVoid(reason: string) {
    const target = voidItem;
    if (!target) return;
    setVoidItem(null);

    setBusy(target.order.id);
    const result = await voidOrderItem(target.itemId, reason);
    setBusy(null);

    if (!result.ok) {
      toast(
        result.error === 'LAST_ITEM'
          ? t.dashboard.cannotVoidLast
          : result.error === 'ALREADY_PAID'
            ? t.dashboard.cannotCancelPaid
            : result.error === 'FORBIDDEN'
              ? t.common.forbidden
              : t.common.error,
        'error',
      );
      return;
    }
    toast(t.dashboard.voidDone, 'success');
    await refetchOrder(target.order.id);
    router.refresh();
  }

  /** Emite el ticket o la factura de una venta ya cobrada. */
  async function confirmInvoice(customer: { name: string; taxId: string; address: string }) {
    const order = invoiceFor;
    if (!order) return;
    setInvoiceFor(null);

    setBusy(order.id);
    const result = await issueFiscalDocument(order.id, {
      name: customer.name,
      taxId: customer.taxId,
      address: customer.address,
    });
    setBusy(null);

    if (!result.ok) {
      toast(
        result.error === 'NOT_PAID'
          ? t.dashboard.paymentRequired
          : result.error === 'FORBIDDEN'
            ? t.common.forbidden
            : t.common.error,
        'error',
      );
      return;
    }
    toast(`${t.dashboard.documentIssued}: ${result.data.fullNumber}`, 'success');
    router.refresh();
  }

  async function confirmFail(reason: string) {
    const order = failFor;
    if (!order) return;
    setFailFor(null);

    setBusy(order.id);
    const result = await failDelivery(order.id, reason);
    setBusy(null);

    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }
    toast(t.dashboard.failDone, 'success');
    await refetchOrder(order.id);
    router.refresh();
  }

  /** Anula el pedido dejando dicho por qué y devolviendo el cupón. */
  async function confirmCancel(reason: string) {
    const order = cancelFor;
    if (!order) return;
    setCancelFor(null);

    setBusy(order.id);
    const result = await cancelOrder(order.id, reason);
    setBusy(null);

    if (!result.ok) {
      toast(
        result.error === 'ALREADY_PAID'
          ? t.dashboard.cannotCancelPaid
          : result.error === 'FORBIDDEN'
            ? t.common.forbidden
            : t.common.error,
        'error',
      );
      return;
    }

    toast(result.data.couponFreed ? t.dashboard.couponFreed : t.dashboard.cancelled, 'success');
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
    served: t.dashboard.markServed,
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
                      <Transcurrido desde={call.createdAt} plano />
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

      <ChargeDialog
        open={chargeFor !== null}
        order={chargeFor}
        currency={currency}
        currencyDecimals={currencyDecimals}
        closing={chargeCloses}
        loading={busy === chargeFor?.id}
        onClose={() => setChargeFor(null)}
        onConfirm={confirmCharge}
      />

      <ReasonDialog
        open={cancelFor !== null}
        title={`${t.dashboard.cancelTitle} #${cancelFor?.code ?? ''}`}
        question={t.dashboard.cancelWhy}
        confirmLabel={t.dashboard.cancelConfirm}
        reasons={MOTIVOS_ANULAR}
        labels={t.dashboard.cancelReasons}
        loading={busy === cancelFor?.id}
        danger
        onClose={() => setCancelFor(null)}
        onConfirm={confirmCancel}
      />

      <RefundDialog
        open={refundFor !== null}
        order={refundFor}
        currency={currency}
        currencyDecimals={currencyDecimals}
        loading={busy === refundFor?.id}
        onClose={() => setRefundFor(null)}
        onConfirm={confirmRefund}
      />

      <DiscountDialog
        open={discountFor !== null}
        order={discountFor}
        currency={currency}
        currencyDecimals={currencyDecimals}
        loading={busy === discountFor?.id}
        onClose={() => setDiscountFor(null)}
        onConfirm={confirmDiscount}
      />

      <ReasonDialog
        open={voidItem !== null}
        title={`${t.dashboard.voidTitle}: ${voidItem?.name ?? ''}`}
        question={t.dashboard.voidWhy}
        confirmLabel={t.dashboard.voidItem}
        reasons={MOTIVOS_QUITAR}
        labels={t.dashboard.voidReasons}
        loading={busy === voidItem?.order.id}
        danger
        onClose={() => setVoidItem(null)}
        onConfirm={confirmVoid}
      />

      <InvoiceDialog
        open={invoiceFor !== null}
        order={invoiceFor}
        loading={busy === invoiceFor?.id}
        onClose={() => setInvoiceFor(null)}
        onConfirm={confirmInvoice}
      />

      <ReasonDialog
        open={failFor !== null}
        title={t.dashboard.failTitle}
        hint={t.dashboard.failHint}
        question={t.dashboard.failWhy}
        confirmLabel={t.dashboard.failDelivery}
        reasons={MOTIVOS_FALLIDA}
        labels={t.dashboard.failReasons}
        loading={busy === failFor?.id}
        danger
        onClose={() => setFailFor(null)}
        onConfirm={confirmFail}
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
                  <Transcurrido desde={order.createdAt} />
                </div>

                <ul className="mt-4 flex-1 space-y-2">
                  {order.items.map((item) => {
                    const quitado = Boolean(item.voidedAt);
                    // Una línea quitada no desaparece de la comanda: se tacha.
                    // Borrarla escondería que alguien retiró un plato.
                    return (
                      <li key={item.id} className={cn('group flex gap-2 text-sm', quitado && 'opacity-50')}>
                        <span className={cn('font-bold text-brand', quitado && 'line-through')}>
                          {item.quantity}×
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn('block font-semibold text-ink-700', quitado && 'line-through')}
                          >
                            {item.name}
                          </span>
                          {item.options.length > 0 && (
                            <span className="block text-xs text-ink-300">{item.options.join(' · ')}</span>
                          )}
                          {item.notes && (
                            <span className="block text-xs italic text-amber-700">“{item.notes}”</span>
                          )}
                          {quitado && (
                            <span className="block text-xs font-semibold text-state-danger">
                              {t.dashboard.voided}
                              {item.voidReason ? ` · ${item.voidReason}` : ''}
                            </span>
                          )}
                        </span>
                        {puedeAnular && !quitado && order.paidCents === 0 && order.status !== 'completed' && (
                          <button
                            type="button"
                            onClick={() => setVoidItem({ order, itemId: item.id, name: item.name })}
                            aria-label={`${t.dashboard.voidItem}: ${item.name}`}
                            title={t.dashboard.voidItem}
                            className="shrink-0 rounded-md p-1 text-ink-200 opacity-0 transition-colors hover:bg-red-50 hover:text-state-danger focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    );
                  })}
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

                {order.deliveryFailedAt && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-state-danger">
                    {t.dashboard.failedBadge}
                    {order.deliveryFailedReason ? ` · ${order.deliveryFailedReason}` : ''}
                  </p>
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
                      order.courierId ? (
                        // Ya tiene repartidor: lo que falta es entregarle la
                        // comida en mano, que es cuando el pedido sale de aquí.
                        <button
                          type="button"
                          onClick={() => entregarAlRepartidor(order)}
                          disabled={busy === order.id}
                          className="btn flex-1 bg-brand text-brand-contrast"
                        >
                          <Truck className="h-4 w-4" />
                          {t.courier.handedToCourier}
                        </button>
                      ) : (
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
                      )
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
                    {puedeCobrar && order.paidCents < order.totalCents && !order.courierId && (
                      <button
                        type="button"
                        onClick={() => {
                          setChargeCloses(false);
                          setChargeFor(order);
                        }}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      >
                        {order.paidCents > 0
                          ? `${t.dashboard.dueNow} ${formatMoney(order.totalCents - order.paidCents, currency, currencyDecimals)}`
                          : t.dashboard.markPaid}
                      </button>
                    )}

                    {puedeCobrar && order.paidCents > 0 && (
                      <button
                        type="button"
                        onClick={() => setInvoiceFor(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-surface-line text-ink-500 hover:bg-surface-field"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {t.dashboard.issueDocument}
                      </button>
                    )}

                    {puedeAnular && order.paidCents > 0 && (
                      <button
                        type="button"
                        onClick={() => setRefundFor(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-state-danger/40 text-state-danger hover:bg-red-50"
                      >
                        {t.dashboard.refund}
                      </button>
                    )}

                    {puedeAnular && canCancel(order.status) && (
                      <button
                        type="button"
                        onClick={() => setCancelFor(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-state-danger/40 text-state-danger hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4" />
                        {t.dashboard.cancelOrder}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {puedeAnular && order.paidCents === 0 && order.status !== 'completed' && (
                      <button
                        type="button"
                        onClick={() => setDiscountFor(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-surface-line text-ink-500 hover:bg-surface-field"
                      >
                        <Percent className="h-3.5 w-3.5" />
                        {order.manualDiscountCents > 0
                          ? formatMoney(order.manualDiscountCents, currency, currencyDecimals)
                          : t.dashboard.discount}
                      </button>
                    )}

                    {/* La entrega fallida sólo tiene sentido con la comida ya
                        en la calle: antes de eso no hay nada que devolver. */}
                    {puedeCobrar && order.status === 'delivering' && (
                      <button
                        type="button"
                        onClick={() => setFailFor(order)}
                        disabled={busy === order.id}
                        className="btn flex-1 border border-amber-300 text-amber-700 hover:bg-amber-50"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        {t.dashboard.failDelivery}
                      </button>
                    )}
                  </div>

                  {puedeAnular && !canCancel(order.status) && order.status !== 'completed' && (
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
