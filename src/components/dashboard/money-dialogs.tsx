'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Banknote, CreditCard, Smartphone } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { formatMoney } from '@/lib/money';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type Method = Extract<Enums<'payment_method'>, 'cash' | 'card' | 'tpv'>;

const METHODS: { id: Method; icon: typeof Banknote }[] = [
  { id: 'cash', icon: Banknote },
  { id: 'card', icon: CreditCard },
  { id: 'tpv', icon: Smartphone },
];

/** Selector de medio de pago, común a cobros y devoluciones. */
function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  const { t } = useI18n();
  const LABEL: Record<Method, string> = {
    cash: t.checkout.cash,
    card: t.checkout.card,
    tpv: t.checkout.tpv,
  };

  return (
    <div className="grid grid-cols-3 gap-3">
      {METHODS.map(({ id, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={active}
            className={cn(
              'flex flex-col items-center gap-2 rounded-2xl border-2 px-2 py-4 transition-colors',
              active
                ? 'border-brand bg-brand-50 text-brand-700'
                : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-xs font-bold">{LABEL[id]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Campo de importe en unidades de la divisa, devuelto en céntimos. */
function AmountField({
  id,
  label,
  cents,
  maxCents,
  decimals,
  onChange,
}: {
  id: string;
  label: string;
  cents: number;
  maxCents: number;
  decimals: number;
  onChange: (cents: number) => void;
}) {
  const factor = 10 ** decimals;
  return (
    <>
      <label className="label mt-5 block" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={maxCents / factor}
        step={1 / factor}
        value={cents === 0 ? '' : (cents / factor).toFixed(decimals)}
        onChange={(e) => {
          const valor = Math.round(Number(e.target.value.replace(',', '.')) * factor);
          onChange(Math.min(Math.max(Number.isFinite(valor) ? valor : 0, 0), maxCents));
        }}
        className="input w-full text-right font-display text-xl tabular-nums"
      />
    </>
  );
}

/** Lista de motivos tipificados más un detalle libre. */
function ReasonPicker<T extends string>({
  label,
  reasons,
  labels,
  value,
  detail,
  onReason,
  onDetail,
}: {
  label: string;
  reasons: readonly T[];
  labels: Record<T, string>;
  value: T;
  detail: string;
  onReason: (r: T) => void;
  onDetail: (d: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <p className="label">{label}</p>
      <div className="flex flex-col gap-2">
        {reasons.map((id) => (
          <label
            key={id}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-sm transition-colors',
              value === id
                ? 'border-brand bg-brand-50 font-bold text-brand-700'
                : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
            )}
          >
            <input
              type="radio"
              name={`motivo-${label}`}
              checked={value === id}
              onChange={() => onReason(id)}
              className="h-4 w-4 accent-brand"
            />
            {labels[id]}
          </label>
        ))}
      </div>
      <label className="label mt-5 block" htmlFor={`detalle-${label}`}>
        {t.dashboard.cancelDetail}
      </label>
      <textarea
        id={`detalle-${label}`}
        value={detail}
        onChange={(e) => onDetail(e.target.value)}
        rows={2}
        maxLength={200}
        className="input w-full resize-none"
      />
    </>
  );
}

function Footer({
  onClose,
  onConfirm,
  confirmLabel,
  loading,
  danger,
  disabled,
}: {
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  loading?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-6 flex gap-3">
      <button type="button" onClick={onClose} className="btn-ghost flex-1">
        {t.common.cancel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading || disabled}
        className={cn('btn flex-1 disabled:opacity-50', danger && 'bg-state-danger text-white')}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

/** Cabecera con el código de la cuenta y el importe que se está tratando. */
function Amount({ code, children }: { code: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-2xl bg-surface-soft px-4 py-3">
      <span className="font-display text-sm font-bold text-ink-500">#{code}</span>
      <span className="font-display text-xl font-bold text-ink-700 tabular-nums">{children}</span>
    </div>
  );
}

// ============================== Cobrar ==============================

export type ChargeTarget = {
  code: string;
  totalCents: number;
  paidCents: number;
  paymentMethod: Enums<'payment_method'>;
};

/**
 * Cobro de una cuenta, entera o a trozos.
 *
 * El caso normal —cobrar lo que falta— está a un solo toque. Dividir es la
 * excepción, así que vive detrás de una pestaña: por importe libre, o repartido
 * a partes iguales entre los comensales, que es como se divide de verdad una
 * cuenta en una mesa.
 */
export function ChargeDialog({
  open,
  order,
  currency,
  currencyDecimals,
  closing,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  order: ChargeTarget | null;
  currency: string;
  currencyDecimals: number;
  /** Si el cobro va seguido del cierre del pedido, para nombrar bien el botón. */
  closing?: boolean;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (method: Method, amountCents: number | null, note: string | null) => void;
}) {
  const { t } = useI18n();
  const sugerido: Method =
    order?.paymentMethod === 'card' || order?.paymentMethod === 'tpv' ? order.paymentMethod : 'cash';
  const falta = order ? Math.max(order.totalCents - order.paidCents, 0) : 0;

  const [method, setMethod] = useState<Method>(sugerido);
  const [modo, setModo] = useState<'todo' | 'parte'>('todo');
  const [importe, setImporte] = useState(0);
  const [nota, setNota] = useState('');

  useEffect(() => {
    if (!open) return;
    setMethod(sugerido);
    setModo('todo');
    setImporte(0);
    setNota('');
  }, [open, sugerido]);

  if (!order) return null;

  const money = (c: number) => formatMoney(c, currency, currencyDecimals);
  const factor = 10 ** currencyDecimals;

  /** Reparto a partes iguales: el resto de la división se lo lleva el primero. */
  function entre(n: number) {
    setModo('parte');
    setImporte(Math.ceil(falta / n / (1 / factor)) * (1 / factor) >= falta ? falta : Math.ceil(falta / n));
    setNota(`1/${n}`);
  }

  return (
    <Sheet open={open} onClose={onClose} title={t.dashboard.chargeBeforeClosing}>
      <Amount code={order.code}>{money(falta)}</Amount>

      {order.paidCents > 0 && (
        <p className="mt-2 text-xs text-ink-300">
          {t.dashboard.partialPaid}: {money(order.paidCents)} · {t.common.total} {money(order.totalCents)}
        </p>
      )}

      <p className="label mt-5">{t.dashboard.chargeWith}</p>
      <MethodPicker value={method} onChange={setMethod} />

      <div className="mt-5 flex gap-2 rounded-xl bg-surface-field p-1">
        {(['todo', 'parte'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setModo(m);
              if (m === 'parte' && importe === 0) setImporte(Math.ceil(falta / 2));
            }}
            aria-pressed={modo === m}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors',
              modo === m ? 'bg-white text-ink shadow-chip' : 'text-ink-400',
            )}
          >
            {m === 'todo' ? t.dashboard.chargeAll : t.dashboard.chargePart}
          </button>
        ))}
      </div>

      {modo === 'parte' && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-400">{t.dashboard.splitEvenly}</span>
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => entre(n)}
                className="h-9 w-9 rounded-lg bg-surface-field text-sm font-bold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
              >
                {n}
              </button>
            ))}
            <span className="text-xs text-ink-300">{t.dashboard.diners}</span>
          </div>

          <AmountField
            id="importe-cobro"
            label={t.dashboard.amountToCharge}
            cents={importe}
            maxCents={falta}
            decimals={currencyDecimals}
            onChange={setImporte}
          />

          <label className="label mt-4 block" htmlFor="nota-cobro">
            {t.dashboard.cancelDetail}
          </label>
          <input
            id="nota-cobro"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={80}
            placeholder="Comensal 2"
            className="input w-full"
          />

          <p className="mt-2 text-xs text-ink-300">
            {t.dashboard.dueNow}: {money(Math.max(falta - importe, 0))}
          </p>
        </>
      )}

      <Footer
        onClose={onClose}
        onConfirm={() =>
          onConfirm(method, modo === 'parte' ? importe : null, modo === 'parte' ? nota || null : null)
        }
        confirmLabel={
          modo === 'parte'
            ? t.dashboard.chargePartial
            : closing
              ? t.dashboard.chargeAndClose
              : t.dashboard.chargeOnly
        }
        loading={loading}
        disabled={modo === 'parte' && importe <= 0}
      />
    </Sheet>
  );
}

// ============================= Devolver =============================

const MOTIVOS_DEVOLUCION = ['quality', 'missing', 'late', 'wrong', 'goodwill', 'other'] as const;

/**
 * Devolución de dinero.
 *
 * Es la primera operación del sistema que saca dinero de la caja, así que pide
 * motivo siempre y enseña de cuánto se dispone: no se puede devolver más de lo
 * que se cobró.
 */
export function RefundDialog({
  open,
  order,
  currency,
  currencyDecimals,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  order: { code: string; paidCents: number; paymentMethod: Enums<'payment_method'> } | null;
  currency: string;
  currencyDecimals: number;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (reason: string, amountCents: number | null, method: Method) => void;
}) {
  const { t } = useI18n();
  const sugerido: Method =
    order?.paymentMethod === 'card' || order?.paymentMethod === 'tpv' ? order.paymentMethod : 'cash';

  const [motivo, setMotivo] = useState<(typeof MOTIVOS_DEVOLUCION)[number]>('quality');
  const [detalle, setDetalle] = useState('');
  const [modo, setModo] = useState<'todo' | 'parte'>('todo');
  const [importe, setImporte] = useState(0);
  const [method, setMethod] = useState<Method>(sugerido);

  useEffect(() => {
    if (!open) return;
    setMotivo('quality');
    setDetalle('');
    setModo('todo');
    setImporte(0);
    setMethod(sugerido);
  }, [open, sugerido]);

  if (!order) return null;

  const money = (c: number) => formatMoney(c, currency, currencyDecimals);
  const etiqueta = t.dashboard.refundReasons[motivo];
  const completo = detalle.trim() ? `${etiqueta} — ${detalle.trim()}` : etiqueta;

  return (
    <Sheet open={open} onClose={onClose} title={t.dashboard.refundTitle}>
      <Amount code={order.code}>{money(order.paidCents)}</Amount>
      <p className="mt-3 text-sm leading-relaxed text-ink-400">{t.dashboard.refundHint}</p>

      <div className="mt-5 flex gap-2 rounded-xl bg-surface-field p-1">
        {(['todo', 'parte'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setModo(m);
              if (m === 'parte' && importe === 0) setImporte(Math.ceil(order.paidCents / 2));
            }}
            aria-pressed={modo === m}
            className={cn(
              'flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors',
              modo === m ? 'bg-white text-ink shadow-chip' : 'text-ink-400',
            )}
          >
            {m === 'todo' ? t.dashboard.refundAll : t.dashboard.refundPart}
          </button>
        ))}
      </div>

      {modo === 'parte' && (
        <AmountField
          id="importe-devolucion"
          label={t.dashboard.refundAmount}
          cents={importe}
          maxCents={order.paidCents}
          decimals={currencyDecimals}
          onChange={setImporte}
        />
      )}

      <p className="label mt-5">{t.dashboard.chargeWith}</p>
      <MethodPicker value={method} onChange={setMethod} />

      <div className="mt-5">
        <ReasonPicker
          label={t.dashboard.refundWhy}
          reasons={MOTIVOS_DEVOLUCION}
          labels={t.dashboard.refundReasons}
          value={motivo}
          detail={detalle}
          onReason={setMotivo}
          onDetail={setDetalle}
        />
      </div>

      <Footer
        onClose={onClose}
        onConfirm={() => onConfirm(completo, modo === 'parte' ? importe : null, method)}
        confirmLabel={t.dashboard.refund}
        loading={loading}
        danger
        disabled={modo === 'parte' && importe <= 0}
      />
    </Sheet>
  );
}

// ============================ Descuento =============================

const MOTIVOS_DESCUENTO = ['invited', 'complaint', 'mistake', 'staff', 'other'] as const;

/** Descuento de la casa: la invitación, el plato que salió mal, la compensación. */
export function DiscountDialog({
  open,
  order,
  currency,
  currencyDecimals,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  order: { code: string; subtotalCents: number; manualDiscountCents: number } | null;
  currency: string;
  currencyDecimals: number;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (cents: number, reason: string) => void;
}) {
  const { t } = useI18n();
  const [motivo, setMotivo] = useState<(typeof MOTIVOS_DESCUENTO)[number]>('invited');
  const [detalle, setDetalle] = useState('');
  const [importe, setImporte] = useState(0);

  useEffect(() => {
    if (!open) return;
    setMotivo('invited');
    setDetalle('');
    setImporte(order?.manualDiscountCents ?? 0);
  }, [open, order?.manualDiscountCents]);

  if (!order) return null;

  const money = (c: number) => formatMoney(c, currency, currencyDecimals);
  const etiqueta = t.dashboard.discountReasons[motivo];
  const completo = detalle.trim() ? `${etiqueta} — ${detalle.trim()}` : etiqueta;

  return (
    <Sheet open={open} onClose={onClose} title={t.dashboard.discountTitle}>
      <Amount code={order.code}>{money(order.subtotalCents)}</Amount>
      <p className="mt-3 text-sm leading-relaxed text-ink-400">{t.dashboard.discountHint}</p>

      <AmountField
        id="importe-descuento"
        label={t.dashboard.discountAmount}
        cents={importe}
        maxCents={order.subtotalCents}
        decimals={currencyDecimals}
        onChange={setImporte}
      />

      <div className="mt-3 flex gap-2">
        {[10, 25, 50, 100].map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => setImporte(Math.round((order.subtotalCents * pct) / 100))}
            className="flex-1 rounded-lg bg-surface-field py-2 text-xs font-bold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            {pct}%
          </button>
        ))}
      </div>

      <div className="mt-5">
        <ReasonPicker
          label={t.dashboard.discountWhy}
          reasons={MOTIVOS_DESCUENTO}
          labels={t.dashboard.discountReasons}
          value={motivo}
          detail={detalle}
          onReason={setMotivo}
          onDetail={setDetalle}
        />
      </div>

      <Footer
        onClose={onClose}
        onConfirm={() => onConfirm(importe, completo)}
        confirmLabel={t.dashboard.discountDone}
        loading={loading}
      />
    </Sheet>
  );
}

// ====================== Motivo suelto (quitar / entrega fallida) ======================

/**
 * Diálogo de motivo reutilizable.
 *
 * Quitar un plato de la comanda y dar una entrega por fallida son la misma
 * conversación con distinta lista: algo se deshace y hace falta saber por qué.
 */
export function ReasonDialog<T extends string>({
  open,
  title,
  hint,
  question,
  confirmLabel,
  reasons,
  labels,
  loading,
  danger,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  hint?: string;
  question: string;
  confirmLabel: string;
  reasons: readonly T[];
  labels: Record<T, string>;
  loading?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [motivo, setMotivo] = useState<T>(reasons[0]);
  const [detalle, setDetalle] = useState('');

  useEffect(() => {
    if (open) {
      setMotivo(reasons[0]);
      setDetalle('');
    }
  }, [open, reasons]);

  const etiqueta = labels[motivo];
  const completo = detalle.trim() ? `${etiqueta} — ${detalle.trim()}` : etiqueta;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {hint && <p className="mb-5 text-sm leading-relaxed text-ink-400">{hint}</p>}
      <ReasonPicker
        label={question}
        reasons={reasons}
        labels={labels}
        value={motivo}
        detail={detalle}
        onReason={setMotivo}
        onDetail={setDetalle}
      />
      <Footer
        onClose={onClose}
        onConfirm={() => onConfirm(completo)}
        confirmLabel={confirmLabel}
        loading={loading}
        danger={danger}
      />
    </Sheet>
  );
}

export const MOTIVOS_QUITAR = ['broken', 'outOfStock', 'mistake', 'customer', 'other'] as const;
export const MOTIVOS_FALLIDA = ['absent', 'unreachable', 'address', 'refused', 'other'] as const;
