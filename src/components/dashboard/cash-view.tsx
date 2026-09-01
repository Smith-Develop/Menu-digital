'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bike,
  LockKeyhole,
  ScrollText,
  Unlock,
  Wallet,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { openCashSession, closeCashSession, addCashMovement } from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatTime, cn } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type CashReport = {
  session: {
    id: string;
    status: 'open' | 'closed';
    opened_at: string;
    opened_by: string | null;
    opening_float_cents: number;
    closed_at: string | null;
    closed_by: string | null;
    counted_cents: number | null;
    expected_cents: number;
    variance_cents: number | null;
    note: string | null;
  };
  collected_cents: number;
  charges_cents: number;
  refunds_cents: number;
  orders: number;
  tips_cents: number;
  by_method: {
    method: Enums<'payment_method'>;
    charges: number;
    charged_cents: number;
    refunded_cents: number;
    net_cents: number;
  }[];
  by_staff: { name: string; charges: number; cents: number }[];
  courier_cash_cents: number;
  /** Todo lo que movió dinero en el turno, en orden: ventas y caja juntas. */
  entries: {
    id: string;
    at: string;
    source: 'sale' | 'movement';
    kind: string;
    amount_cents: number;
    method: Enums<'payment_method'>;
    order_code: string | null;
    order_type: Enums<'order_type'> | null;
    label: string | null;
    by: string | null;
    by_courier: boolean;
    /** Si ese dinero está de verdad en el cajón: la tarjeta y lo que lleva
     *  encima un repartidor, no. */
    in_drawer: boolean;
  }[];
  movements: {
    id: string;
    kind: Enums<'cash_movement_kind'>;
    amount_cents: number;
    method: Enums<'payment_method'>;
    reason: string;
    created_at: string;
    by: string | null;
  }[];
  movements_in_cents: number;
  movements_out_cents: number;
  discounts_cents: number;
  voided_items: number;
  cancelled_orders: number;
};

export type CashHistoryRow = {
  id: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
  opening_float_cents: number;
  counted_cents: number | null;
  expected_cents: number | null;
  variance_cents: number | null;
  collected_cents: number;
};

export type AuditRow = {
  id: number;
  entity: string;
  action: string;
  before_cents: number | null;
  after_cents: number | null;
  reason: string | null;
  actor: string;
  actor_role: string | null;
  created_at: string;
  order_code: string | null;
};

const KINDS: Enums<'cash_movement_kind'>[] = [
  'payout',
  'withdrawal',
  'deposit',
  'tip_out',
  'correction',
  'other',
];

/** Etiqueta e importe, con la coma decimal que usa la aplicación. */
function AmountField({
  id,
  label,
  hint,
  cents,
  decimals,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  cents: number;
  decimals: number;
  onChange: (cents: number) => void;
}) {
  return (
    <>
      <label className="label block" htmlFor={id}>
        {label}
      </label>
      <MoneyInput id={id} value={cents} decimals={decimals} onChange={onChange} className="text-2xl" />
      {hint && <p className="mt-1.5 text-xs text-ink-300">{hint}</p>}
    </>
  );
}

function Fila({
  label,
  value,
  tone = 'normal',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'strong' | 'danger' | 'success' | 'muted';
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span
        className={cn(
          'text-sm',
          tone === 'strong' ? 'font-bold text-ink-700' : 'text-ink-400',
          tone === 'muted' && 'text-ink-300',
        )}
      >
        {label}
        {hint && <span className="block text-[11px] text-ink-300">{hint}</span>}
      </span>
      <span
        className={cn(
          'shrink-0 font-display tabular-nums',
          tone === 'strong' ? 'text-lg font-bold text-ink' : 'text-sm font-semibold text-ink-600',
          tone === 'danger' && 'text-state-danger',
          tone === 'success' && 'text-emerald-600',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Caja del turno.
 *
 * La cifra que manda es el descuadre, así que va arriba y en grande: es lo
 * único que no se puede deducir mirando los pedidos, y lo único que obliga a
 * hacer algo cuando no sale.
 */
export function CashView({
  report,
  history,
  audit,
  currency,
  currencyDecimals,
}: {
  report: CashReport | null;
  history: CashHistoryRow[];
  audit: AuditRow[];
  currency: string;
  currencyDecimals: number;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [abriendo, setAbriendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [moviendo, setMoviendo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [fondo, setFondo] = useState(0);
  const [contado, setContado] = useState(0);
  const [nota, setNota] = useState('');
  const [kind, setKind] = useState<Enums<'cash_movement_kind'>>('payout');
  const [importe, setImporte] = useState(0);
  const [concepto, setConcepto] = useState('');

  const money = (c: number) => formatMoney(c, currency, currencyDecimals);
  const abierta = report?.session.status === 'open';

  async function abrir() {
    setGuardando(true);
    const result = await openCashSession(fondo, nota);
    setGuardando(false);
    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }
    setAbriendo(false);
    setFondo(0);
    setNota('');
    toast(t.cash.opened, 'success');
    router.refresh();
  }

  async function cerrar() {
    if (!report) return;
    setGuardando(true);
    const result = await closeCashSession(report.session.id, contado, nota);
    setGuardando(false);
    if (!result.ok) {
      toast(result.error === 'FORBIDDEN' ? t.common.forbidden : t.common.error, 'error');
      return;
    }
    setCerrando(false);
    setContado(0);
    setNota('');

    const desfase = result.data.varianceCents;
    toast(
      desfase === 0
        ? t.cash.balanced
        : `${desfase > 0 ? t.cash.over : t.cash.short}: ${money(Math.abs(desfase))}`,
      desfase === 0 ? 'success' : 'info',
    );
    router.refresh();
  }

  async function mover() {
    setGuardando(true);
    const result = await addCashMovement(kind, importe, concepto);
    setGuardando(false);
    if (!result.ok) {
      toast(
        result.error === 'NO_OPEN_SESSION'
          ? t.cash.noOpenSession
          : result.error === 'FORBIDDEN'
            ? t.common.forbidden
            : t.common.error,
        'error',
      );
      return;
    }
    setMoviendo(false);
    setImporte(0);
    setConcepto('');
    router.refresh();
  }

  const METHOD_LABEL: Record<string, string> = {
    cash: t.checkout.cash,
    card: t.checkout.card,
    tpv: t.checkout.tpv,
    stripe: t.checkout.card,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t.cash.title}</h1>
        {abierta ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setMoviendo(true)} className="btn-ghost text-sm">
              <Wallet className="h-4 w-4" />
              {t.cash.addMovement}
            </button>
            <button
              type="button"
              onClick={() => {
                setContado(report?.session.expected_cents ?? 0);
                setCerrando(true);
              }}
              className="btn-primary text-sm"
            >
              <LockKeyhole className="h-4 w-4" />
              {t.cash.close}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setAbriendo(true)} className="btn-primary text-sm">
            <Unlock className="h-4 w-4" />
            {t.cash.open}
          </button>
        )}
      </div>

      {!abierta && (
        <EmptyState
          icon={<Wallet className="h-7 w-7" />}
          title={t.cash.closed}
          description={t.cash.closedHint}
          className="rounded-2xl bg-white shadow-chip"
        />
      )}

      {abierta && report && (
        <>
          {/* Lo que debería haber en el cajón: la cifra que se compara al cerrar. */}
          <section className="rounded-2xl bg-ink p-6 text-white shadow-chip">
            <p className="text-xs font-bold uppercase tracking-wide text-white/50">
              {t.cash.inDrawer}
            </p>
            <p className="mt-2 font-display text-4xl font-bold tabular-nums">
              {money(report.session.expected_cents)}
            </p>
            <p className="mt-2 text-xs text-white/60">
              {t.cash.openedAt} {formatDateTime(report.session.opened_at, locale)}
              {report.session.opened_by ? ` · ${report.session.opened_by}` : ''}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/15 pt-4 sm:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50">{t.cash.float}</p>
                <p className="font-display text-lg font-bold tabular-nums">
                  {money(report.session.opening_float_cents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50">{t.cash.sales}</p>
                <p className="font-display text-lg font-bold tabular-nums">
                  {money(report.collected_cents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50">
                  {t.cash.movements}
                </p>
                <p className="font-display text-lg font-bold tabular-nums">
                  {money(report.movements_in_cents - report.movements_out_cents)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/50">
                  {t.cash.ordersCount}
                </p>
                <p className="font-display text-lg font-bold tabular-nums">{report.orders}</p>
              </div>
            </div>
          </section>

          {/* El efectivo del repartidor no está en el cajón: se enseña aparte
              para que nadie lo cuente dos veces al cuadrar. */}
          {report.courier_cash_cents > 0 && (
            <section className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-ink">
                <Bike className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900">{t.cash.courierCash}</p>
                <p className="mt-0.5 text-xs text-amber-800/80">{t.cash.courierCashHint}</p>
              </div>
              <span className="shrink-0 font-display text-xl font-bold text-amber-900 tabular-nums">
                {money(report.courier_cash_cents)}
              </span>
            </section>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl bg-white p-5 shadow-chip">
              <h2 className="mb-3 font-display text-base font-bold text-ink-700">
                {t.cash.byMethod}
              </h2>
              {report.by_method.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-300">{t.analytics.noData}</p>
              ) : (
                <div className="divide-y divide-surface-line">
                  {report.by_method.map((m) => (
                    <Fila
                      key={m.method}
                      label={METHOD_LABEL[m.method] ?? m.method}
                      hint={`${m.charges} ${t.analytics.ordersShort}`}
                      value={money(m.net_cents)}
                    />
                  ))}
                </div>
              )}

              {/* El separador sólo aparece si hay algo debajo: sin esto queda
                  una raya suelta bajo el «sin datos». */}
              {(report.refunds_cents > 0 ||
                report.tips_cents > 0 ||
                report.discounts_cents > 0 ||
                report.voided_items > 0 ||
                report.cancelled_orders > 0) && (
              <div className="mt-3 border-t border-surface-line pt-3">
                {report.refunds_cents > 0 && (
                  <Fila label={t.cash.refunds} value={`−${money(report.refunds_cents)}`} tone="danger" />
                )}
                {report.tips_cents > 0 && <Fila label={t.cash.tips} value={money(report.tips_cents)} />}
                {report.discounts_cents > 0 && (
                  <Fila label={t.cash.discounts} value={`−${money(report.discounts_cents)}`} tone="danger" />
                )}
                {report.voided_items > 0 && (
                  <Fila label={t.cash.voidedItems} value={String(report.voided_items)} tone="muted" />
                )}
                {report.cancelled_orders > 0 && (
                  <Fila label={t.cash.cancelledOrders} value={String(report.cancelled_orders)} tone="muted" />
                )}
              </div>
              )}
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-chip">
              <h2 className="mb-3 font-display text-base font-bold text-ink-700">
                {t.cash.byStaff}
              </h2>
              {report.by_staff.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-300">{t.analytics.noData}</p>
              ) : (
                <div className="divide-y divide-surface-line">
                  {report.by_staff.map((p) => (
                    <Fila
                      key={p.name}
                      label={p.name}
                      hint={`${p.charges} ${t.analytics.ordersShort}`}
                      value={money(p.cents)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl bg-white p-5 shadow-chip">
            <h2 className="font-display text-base font-bold text-ink-700">{t.cash.movements}</h2>
            <p className="mb-3 mt-1 text-xs text-ink-300">{t.cash.movementsHint}</p>

            {(report.entries ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-300">{t.cash.noMovements}</p>
            ) : (
              <ul className="divide-y divide-surface-line">
                {(report.entries ?? []).map((e) => {
                  const entra = e.amount_cents > 0;
                  const etiqueta =
                    e.source === 'sale'
                      ? e.kind === 'refund'
                        ? t.cash.refunds
                        : `${t.cash.sale} · ${METHOD_LABEL[e.method] ?? e.method}`
                      : (t.cash.kinds[e.kind as keyof typeof t.cash.kinds] ?? e.kind);

                  return (
                    <li key={e.id} className="flex items-center gap-3 py-2.5">
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          entra ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-state-danger',
                        )}
                      >
                        {entra ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-semibold text-ink-700">{etiqueta}</span>
                          {e.order_code && (
                            <span className="text-xs text-ink-300">#{e.order_code}</span>
                          )}
                          {/* Lo que no está en el cajón se dice, o al contar el
                              efectivo del cierre parecería que falta dinero. */}
                          {!e.in_drawer && (
                            <span className="rounded-md bg-surface-field px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-300">
                              {e.by_courier ? t.cash.onTheRoad : t.cash.notInDrawer}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-ink-300">
                          {[e.label, e.by, formatTime(e.at, locale)].filter(Boolean).join(' · ')}
                        </span>
                      </span>

                      <span
                        className={cn(
                          'shrink-0 font-display text-sm font-bold tabular-nums',
                          entra ? 'text-emerald-600' : 'text-state-danger',
                        )}
                      >
                        {entra ? '+' : '−'}
                        {money(Math.abs(e.amount_cents))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Rastro del dinero: todo lo que reduce una venta. */}
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <ScrollText className="h-4 w-4 text-ink-300" />
          {t.cash.audit}
        </h2>
        <p className="mb-3 mt-1 text-xs text-ink-300">{t.cash.auditHint}</p>
        {audit.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-300">{t.cash.noAudit}</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {audit.map((a) => {
              // El importe de un rastro no siempre se lee igual: en un
              // descuento es cuánto se invitó, en una anulación lo que se dejó
              // de cobrar, en una apertura el fondo y en un cierre el
              // descuadre. Con una resta genérica el número no diría nada.
              const antes = a.before_cents ?? 0;
              const despues = a.after_cents ?? 0;
              // Una anulación o una línea retirada valen lo que se dejó de
              // cobrar; el resto son diferencias. Poner el importe anterior en
              // un cambio de total hacía leer "se quitaron 29,70" cuando lo que
              // pasó fue que 29,70 se quedaron en 24,20.
              const importe =
                a.action === 'cancel' || a.action === 'void_item' ? -antes
                : a.action === 'open' ? despues
                : despues - antes;
              const resta = importe < 0;

              return (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="font-semibold text-ink-700">
                    {t.cash.actions[a.action as keyof typeof t.cash.actions] ?? a.action}
                  </span>
                  {a.order_code && <span className="text-xs text-ink-300">#{a.order_code}</span>}
                  {a.reason && (
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-400">{a.reason}</span>
                  )}

                  {importe !== 0 && (
                    <span
                      className={cn(
                        'ml-auto shrink-0 font-display text-sm font-bold tabular-nums',
                        resta ? 'text-state-danger' : 'text-ink-600',
                      )}
                    >
                      {resta ? '−' : ''}
                      {money(Math.abs(importe))}
                    </span>
                  )}

                  <span className={cn('shrink-0 text-xs text-ink-300', importe === 0 && 'ml-auto')}>
                    {a.actor}
                    {a.actor_role ? ` · ${a.actor_role}` : ''}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-300">
                    {formatDateTime(a.created_at, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Turnos anteriores: el descuadre de cada uno, que es lo que se revisa. */}
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="mb-3 font-display text-base font-bold text-ink-700">{t.cash.history}</h2>
        {history.filter((h) => h.status === 'closed').length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-300">{t.cash.noHistory}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-surface-line text-left text-xs uppercase tracking-wide text-ink-300">
                  <th className="pb-2 font-semibold">{t.cash.openedAt}</th>
                  <th className="pb-2 font-semibold">{t.cash.openedBy}</th>
                  <th className="pb-2 text-right font-semibold">{t.cash.sales}</th>
                  <th className="pb-2 text-right font-semibold">{t.cash.expected}</th>
                  <th className="pb-2 text-right font-semibold">{t.cash.counted}</th>
                  <th className="pb-2 text-right font-semibold">{t.cash.variance}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line">
                {history
                  .filter((h) => h.status === 'closed')
                  .map((h) => (
                    <tr key={h.id}>
                      <td className="py-2.5 text-ink-500">{formatDateTime(h.opened_at, locale)}</td>
                      <td className="py-2.5 text-ink-400">{h.closed_by ?? h.opened_by ?? '—'}</td>
                      <td className="py-2.5 text-right tabular-nums text-ink-500">
                        {money(h.collected_cents)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-ink-400">
                        {money(h.expected_cents ?? 0)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-ink-400">
                        {money(h.counted_cents ?? 0)}
                      </td>
                      <td
                        className={cn(
                          'py-2.5 text-right font-bold tabular-nums',
                          (h.variance_cents ?? 0) === 0
                            ? 'text-emerald-600'
                            : 'text-state-danger',
                        )}
                      >
                        {(h.variance_cents ?? 0) > 0 ? '+' : ''}
                        {money(h.variance_cents ?? 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- Abrir ---------- */}
      <Sheet open={abriendo} onClose={() => setAbriendo(false)} title={t.cash.openTitle}>
        <AmountField
          id="fondo-caja"
          label={t.cash.float}
          hint={t.cash.floatHint}
          cents={fondo}
          decimals={currencyDecimals}
          onChange={setFondo}
        />
        <label className="label mt-5 block" htmlFor="nota-apertura">
          {t.dashboard.cancelDetail}
        </label>
        <input
          id="nota-apertura"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={120}
          className="field w-full"
        />
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => setAbriendo(false)} className="btn-ghost flex-1">
            {t.common.cancel}
          </button>
          <button type="button" onClick={abrir} disabled={guardando} className="btn-primary flex-1 disabled:opacity-50">
            {t.cash.open}
          </button>
        </div>
      </Sheet>

      {/* ---------- Cerrar ---------- */}
      <Sheet open={cerrando} onClose={() => setCerrando(false)} title={t.cash.closeTitle}>
        <p className="mb-5 text-sm leading-relaxed text-ink-400">{t.cash.closeHint}</p>

        <AmountField
          id="contado-caja"
          label={t.cash.counted}
          cents={contado}
          decimals={currencyDecimals}
          onChange={setContado}
        />

        {report && (
          <div className="mt-5 rounded-2xl bg-surface-soft p-4">
            <Fila label={t.cash.expected} value={money(report.session.expected_cents)} />
            <div className="mt-1 border-t border-surface-line pt-2">
              <Fila
                label={t.cash.variance}
                value={money(contado - report.session.expected_cents)}
                tone={
                  contado - report.session.expected_cents === 0
                    ? 'success'
                    : 'danger'
                }
              />
            </div>
            <p className="mt-2 text-xs text-ink-300">
              {contado - report.session.expected_cents === 0
                ? t.cash.balanced
                : contado - report.session.expected_cents > 0
                  ? t.cash.over
                  : t.cash.short}
            </p>
          </div>
        )}

        <label className="label mt-5 block" htmlFor="nota-cierre">
          {t.dashboard.cancelDetail}
        </label>
        <input
          id="nota-cierre"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={120}
          className="field w-full"
        />

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => setCerrando(false)} className="btn-ghost flex-1">
            {t.common.cancel}
          </button>
          <button type="button" onClick={cerrar} disabled={guardando} className="btn-primary flex-1 disabled:opacity-50">
            {t.cash.close}
          </button>
        </div>
      </Sheet>

      {/* ---------- Movimiento ---------- */}
      <Sheet open={moviendo} onClose={() => setMoviendo(false)} title={t.cash.movementTitle}>
        <label className="label block" htmlFor="tipo-movimiento">
          {t.cash.movementKind}
        </label>
        <Select
          id="tipo-movimiento"
          value={kind}
          onChange={(e) => setKind(e.target.value as Enums<'cash_movement_kind'>)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.cash.kinds[k]}
            </option>
          ))}
        </Select>

        <div className="mt-5">
          <AmountField
            id="importe-movimiento"
            label={t.cash.movementAmount}
            cents={importe}
            decimals={currencyDecimals}
            onChange={setImporte}
          />
        </div>

        <label className="label mt-5 block" htmlFor="concepto-movimiento">
          {t.cash.movementReason}
        </label>
        <input
          id="concepto-movimiento"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          maxLength={120}
          placeholder="Hielo y servilletas"
          className="field w-full"
        />

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => setMoviendo(false)} className="btn-ghost flex-1">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={mover}
            disabled={guardando || importe <= 0 || !concepto.trim()}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {t.cash.addMovement}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
