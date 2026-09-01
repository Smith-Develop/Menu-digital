'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BellRing, LogOut, Plus, UserRound, Users, Wallet } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { Badge, EmptyState } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { assignTableWaiter, endTableSession, payTableBill } from '@/app/dashboard/actions';
import { ChargeDialog, type Method } from '@/components/dashboard/money-dialogs';
import { formatMoney } from '@/lib/money';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type FloorTable = {
  id: string;
  name: string;
  code: string;
  seats: number;
  waiter_id: string | null;
  waiter_name: string | null;
  assigned_at: string | null;
  pending_calls: number;
  total_cents: number;
  /** Lo que queda por cobrar: el total menos lo ya entregado a cuenta. */
  due_cents: number;
  orders: {
    id: string;
    code: string;
    status: string;
    payment_status: string;
    total_cents: number;
    paid_cents: number;
    created_at: string;
  }[];
};

/**
 * Estado de la sala.
 *
 * Una mesa está ocupada mientras tenga algo sin cobrar. Es el mismo criterio
 * que usa la cuenta del comensal, de modo que la sala nunca dice "libre" sobre
 * una mesa que todavía tiene pedidos pendientes de pagar.
 */
export function FloorView({
  tables,
  waiters,
  currency,
  currencyDecimals,
  slug,
  canAssign,
  currentUserId,
  compact = false,
  canEndSessions = false,
  canCharge = false,
}: {
  tables: FloorTable[];
  waiters: { id: string; name: string }[];
  currency: string;
  currencyDecimals: number;
  slug: string;
  canAssign: boolean;
  currentUserId: string;
  /** Junto a los pedidos, la sala se enseña resumida para no comerse la vista. */
  compact?: boolean;
  /** Cerrar la sesión de una mesa echa al cliente que la tuviera abierta. */
  canEndSessions?: boolean;
  /** Cobrar la cuenta: quien atiende y quien lleva la caja. */
  canCharge?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmarLiberar, setConfirmarLiberar] = useState<FloorTable | 'todas' | null>(null);
  const [cobrarMesa, setCobrarMesa] = useState<FloorTable | null>(null);

  /**
   * Cobra la cuenta de la mesa, entera o a trozos.
   *
   * El importe se reparte entre las comandas abiertas de la más antigua a la
   * más nueva, así que dividir entre comensales funciona igual con una comanda
   * que con cinco: el comensal paga su parte y la mesa va bajando.
   */
  async function cobrar(method: Method, amountCents: number | null, note: string | null) {
    const mesa = cobrarMesa;
    if (!mesa) return;
    setCobrarMesa(null);

    setBusy(mesa.id);
    const result = await payTableBill(mesa.id, method, amountCents, note);
    setBusy(null);

    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }

    toast(
      result.data.dueCents === 0
        ? t.dashboard.tableSettled
        : `${t.dashboard.dueNow}: ${formatMoney(result.data.dueCents, currency, currencyDecimals)}`,
      result.data.dueCents === 0 ? 'success' : 'info',
    );
    router.refresh();
  }

  // La sala cambia sin que nadie toque esta pantalla: entran pedidos y avisos.
  useEffect(() => {
    const temporizador = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(temporizador);
  }, [router]);

  async function liberar(mesa: FloorTable | null) {
    setBusy(mesa?.id ?? 'todas');
    const result = await endTableSession(mesa?.id ?? null);
    setBusy(null);
    setConfirmarLiberar(null);

    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    toast(mesa ? t.floor.sessionEnded : t.floor.allSessionsEnded, 'success');
    router.refresh();
  }

  async function pedirPara(mesa: FloorTable) {
    // Sin dueño, o siendo otro quien va a tomar la comanda, la mesa cambia de
    // manos antes de abrir la carta.
    if (mesa.waiter_id !== currentUserId) {
      setBusy(mesa.id);
      await assignTableWaiter(mesa.id, currentUserId);
      setBusy(null);
    }
    router.push(`/m/${mesa.code}`);
  }

  async function asignar(tableId: string, waiterId: string) {
    setBusy(tableId);
    const result = await assignTableWaiter(tableId, waiterId || null);
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  const ocupadas = tables.filter((mesa) => mesa.orders.length > 0);
  const libres = tables.filter((mesa) => mesa.orders.length === 0);
  const mias = tables.filter((mesa) => mesa.waiter_id === currentUserId);

  if (tables.length === 0) {
    return compact ? null : <EmptyState icon={<Users className="h-7 w-7" />} title={t.floor.noTables} />;
  }

  return (
    <div className="space-y-6">
      {canEndSessions && !compact && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setConfirmarLiberar('todas')}
            className="btn-ghost text-xs"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t.floor.endAllSessions}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Resumen valor={ocupadas.length} etiqueta={t.floor.busy} tono="brand" />
        <Resumen valor={libres.length} etiqueta={t.floor.free} tono="success" />
        <Resumen valor={mias.length} etiqueta={t.floor.mine} tono="neutral" />
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(compact
          ? tables.filter((mesa) => mesa.orders.length > 0 || mesa.pending_calls > 0)
          : tables
        ).map((mesa) => {
          const ocupada = mesa.orders.length > 0;
          return (
            <li
              key={mesa.id}
              className={cn(
                'rounded-2xl bg-white p-4 shadow-chip',
                mesa.pending_calls > 0 && 'ring-2 ring-amber-400',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-base font-bold text-ink-700">{mesa.name}</p>
                  <p className="text-xs text-ink-300">
                    {mesa.seats} {t.floor.seats}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <Badge tone={ocupada ? 'brand' : 'success'}>
                    {ocupada ? t.floor.busyOne : t.floor.freeOne}
                  </Badge>
                  {mesa.pending_calls > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                      <BellRing className="h-3.5 w-3.5" />
                      {mesa.pending_calls}
                    </span>
                  )}
                </div>
              </div>

              {ocupada && (
                <div className="mt-3 space-y-1.5 rounded-xl bg-surface-field p-3">
                  {mesa.orders.map((pedido) => (
                    <div key={pedido.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-ink-600">#{pedido.code}</span>
                      <span className="text-ink-300">{t.order.status[pedido.status as 'ready']}</span>
                      <span className="font-bold text-ink">
                        {formatMoney(pedido.total_cents, currency, currencyDecimals)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-surface-line pt-1.5 text-sm">
                    <span className="font-semibold text-ink-500">
                      {mesa.due_cents < mesa.total_cents ? t.dashboard.dueNow : t.common.total}
                    </span>
                    <span className="font-bold text-ink">
                      {formatMoney(mesa.due_cents, currency, currencyDecimals)}
                    </span>
                  </div>
                  {mesa.due_cents < mesa.total_cents && (
                    <p className="text-right text-[11px] text-ink-300">
                      {t.dashboard.partialPaid}:{' '}
                      {formatMoney(mesa.total_cents - mesa.due_cents, currency, currencyDecimals)}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-3 space-y-2">
                {canAssign ? (
                  <Select
                    value={mesa.waiter_id ?? ''}
                    onChange={(e) => asignar(mesa.id, e.target.value)}
                    disabled={busy === mesa.id}
                    className="py-2 text-xs"
                    aria-label={t.floor.assignedWaiter}
                  >
                    <option value="">{t.floor.noWaiter}</option>
                    {waiters.map((camarero) => (
                      <option key={camarero.id} value={camarero.id}>
                        {camarero.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-ink-300">
                    <UserRound className="h-3.5 w-3.5" />
                    {mesa.waiter_name ?? t.floor.noWaiter}
                  </p>
                )}

                {/* Pedir por el cliente: se abre la carta ya situada en la mesa.
                    Quien lo hace se queda con la mesa, que es lo que ocurre en
                    la práctica —quien toma la comanda la atiende— y así sus
                    avisos le llegan sin tener que asignarse a mano. */}
                {canCharge && mesa.due_cents > 0 && (
                  <button
                    type="button"
                    onClick={() => setCobrarMesa(mesa)}
                    disabled={busy === mesa.id}
                    className="btn w-full border border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-50"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    {t.dashboard.payTable}
                  </button>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => pedirPara(mesa)}
                    disabled={busy === mesa.id}
                    className="btn-ghost flex-1 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t.floor.orderForTable}
                  </button>

                  {canEndSessions && (
                    <button
                      type="button"
                      onClick={() => setConfirmarLiberar(mesa)}
                      disabled={busy === mesa.id}
                      aria-label={t.floor.endSession}
                      title={t.floor.endSession}
                      className="btn shrink-0 px-3 text-xs text-ink-300 hover:bg-red-50 hover:text-state-danger"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <ChargeDialog

        open={cobrarMesa !== null}

        order={

          cobrarMesa

            ? {

                code: cobrarMesa.name,

                totalCents: cobrarMesa.total_cents,

                paidCents: cobrarMesa.total_cents - cobrarMesa.due_cents,

                paymentMethod: 'cash' as const,

              }

            : null

        }

        currency={currency}

        currencyDecimals={currencyDecimals}

        loading={busy === cobrarMesa?.id}

        onClose={() => setCobrarMesa(null)}

        onConfirm={cobrar}

      />


      <ConfirmDialog
        open={confirmarLiberar !== null}
        onClose={() => setConfirmarLiberar(null)}
        onConfirm={() => liberar(confirmarLiberar === 'todas' ? null : confirmarLiberar)}
        title={confirmarLiberar === 'todas' ? t.floor.endAllSessions : t.floor.endSession}
        message={t.floor.endSessionHint}
        confirmLabel={t.floor.endSession}
        cancelLabel={t.common.cancel}
        loading={busy !== null}
      />
    </div>
  );
}

function Resumen({
  valor,
  etiqueta,
  tono,
}: {
  valor: number;
  etiqueta: string;
  tono: 'brand' | 'success' | 'neutral';
}) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-chip">
      <p
        className={cn(
          'font-display text-2xl font-bold',
          tono === 'brand' ? 'text-brand' : tono === 'success' ? 'text-state-success' : 'text-ink',
        )}
      >
        {valor}
      </p>
      <p className="text-xs text-ink-300">{etiqueta}</p>
    </div>
  );
}
