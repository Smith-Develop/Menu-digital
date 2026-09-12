'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

/** Cada cuánto se vuelve a preguntar, y cuánto se espera antes de rendirse. */
const CADA = 2500;
const HASTA = 60_000;

/**
 * Qué ha pasado con el pago.
 *
 * No se fía de la dirección de vuelta: la controla el navegador y decir
 * «?estado=aprobado» no cuesta nada. Lo que vale es el estado del intento en
 * nuestra base, que sólo cambia cuando llega el aviso firmado de la pasarela y
 * se confirma contra su API.
 *
 * Por eso hay espera. El aviso tarda entre uno y varios segundos, y en ese rato
 * quien ha pagado necesita ver que algo está pasando en lugar de una pantalla
 * que dice que no.
 */
export function PaymentReturn({
  intentId,
  estado,
  amountCents,
  currency,
  orderCode,
  orderToken,
  cancelado,
}: {
  intentId: string;
  estado: Enums<'payment_intent_status'>;
  amountCents: number;
  currency: string;
  orderCode: string;
  orderToken: string;
  cancelado: boolean;
}) {
  const t = useT();
  const [actual, setActual] = useState(estado);
  const [tarda, setTarda] = useState(false);

  useEffect(() => {
    if (actual === 'paid' || actual === 'failed' || actual === 'cancelled') return;

    const supabase = createClient();
    const desde = Date.now();

    const id = setInterval(async () => {
      // Por función y no por la tabla: quien paga puede no tener cuenta, y las
      // políticas del intento sólo dejan mirar al equipo del local. La función
      // devuelve el estado y el importe, y nada más.
      const { data } = await supabase.rpc('payment_intent_state', { p_intent_id: intentId });
      const estadoNuevo = (data as { status?: Enums<'payment_intent_status'> } | null)?.status;

      if (estadoNuevo && estadoNuevo !== actual) setActual(estadoNuevo);
      if (Date.now() - desde > HASTA) setTarda(true);
    }, CADA);

    return () => clearInterval(id);
  }, [actual, intentId]);

  const pagado = actual === 'paid';
  const fallado = actual === 'failed' || actual === 'expired';
  const anulado = actual === 'cancelled' || cancelado;
  const esperando = !pagado && !fallado && !anulado;

  const titulo = pagado
    ? t.pay.paid
    : anulado
      ? t.pay.cancelled
      : fallado
        ? actual === 'expired'
          ? t.pay.expired
          : t.pay.rejected
        : t.pay.waiting;

  const pie = pagado
    ? t.pay.paidHint
    : esperando
      ? tarda
        ? t.pay.takingLong
        : t.pay.waitingHint
      : t.pay.rejectedHint;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <span
        className={cn(
          'flex h-16 w-16 items-center justify-center rounded-full',
          pagado
            ? 'bg-state-success/10 text-state-success'
            : esperando
              ? 'bg-surface-field text-ink-400'
              : 'bg-state-danger/10 text-state-danger',
        )}
      >
        {pagado ? (
          <Check className="h-8 w-8" />
        ) : esperando ? (
          <Clock className="h-8 w-8 animate-pulse" />
        ) : (
          <X className="h-8 w-8" />
        )}
      </span>

      <h1 className="mt-5 font-display text-2xl font-bold text-ink">{titulo}</h1>
      <p className="mt-2 text-sm text-ink-300">{pie}</p>

      <p className="mt-6 font-display text-3xl font-bold tabular-nums text-ink">
        {formatMoney(amountCents, currency)}
      </p>
      {orderCode && <p className="mt-1 font-mono text-xs text-ink-300">#{orderCode}</p>}

      <div className="mt-8 w-full space-y-3">
        {orderToken && (
          <Link href={`/order/${orderToken}`} className="btn-primary w-full py-3.5">
            {t.pay.seeOrder}
          </Link>
        )}
      </div>
    </div>
  );
}
