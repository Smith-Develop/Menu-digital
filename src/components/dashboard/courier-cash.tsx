'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Wallet } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { settleCourierCash } from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { useT } from '@/i18n/provider';

export type CourierCash = {
  courierId: string;
  name: string;
  orders: number;
  cents: number;
};

/**
 * Efectivo que los repartidores deben al restaurante.
 *
 * Un pedido cobrado en la puerta no está cerrado para el local hasta que ese
 * dinero entra en su caja: por eso sigue contando aquí aunque el cliente ya lo
 * tenga. Se liquida por repartidor, no pedido a pedido, porque el dinero se
 * entrega de una vez al terminar el turno.
 */
export function CourierCashPanel({
  pending,
  currency,
  currencyDecimals,
}: {
  pending: CourierCash[];
  currency: string;
  currencyDecimals: number;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [confirmar, setConfirmar] = useState<CourierCash | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (pending.length === 0) return null;

  const total = pending.reduce((suma, fila) => suma + fila.cents, 0);

  async function liquidar() {
    if (!confirmar) return;
    setGuardando(true);
    const result = await settleCourierCash(confirmar.courierId);
    setGuardando(false);
    setConfirmar(null);

    if (!result.ok) {
      toast(result.error ?? t.common.error, 'error');
      return;
    }
    toast(t.courier.cashSettled, 'success');
    router.refresh();
  }

  return (
    <>
      <section className="rounded-2xl bg-amber-50 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-ink">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-900">{t.courier.cashPending}</p>
            <p className="mt-0.5 text-xs text-amber-800/80">{t.courier.cashPendingHint}</p>
          </div>
          <span className="shrink-0 font-display text-xl font-bold text-amber-900">
            {formatMoney(total, currency, currencyDecimals)}
          </span>
        </div>

        <ul className="mt-4 space-y-2">
          {pending.map((fila) => (
            <li
              key={fila.courierId}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 px-3 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-900">
                {fila.name}
              </span>
              <span className="shrink-0 text-xs text-amber-800/70">{fila.orders}</span>
              <span className="shrink-0 text-sm font-bold text-amber-900">
                {formatMoney(fila.cents, currency, currencyDecimals)}
              </span>
              <button
                type="button"
                onClick={() => setConfirmar(fila)}
                className="btn shrink-0 bg-amber-400 px-3 py-1.5 text-xs font-bold text-ink"
              >
                <Check className="h-3.5 w-3.5" />
                {t.courier.receiveCash}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={confirmar !== null}
        onClose={() => setConfirmar(null)}
        onConfirm={liquidar}
        title={t.courier.receiveCash}
        message={
          confirmar
            ? t.courier.receiveCashHint
                .replace('{name}', confirmar.name)
                .replace('{amount}', formatMoney(confirmar.cents, currency, currencyDecimals))
            : ''
        }
        confirmLabel={t.courier.receiveCash}
        cancelLabel={t.common.cancel}
        loading={guardando}
      />
    </>
  );
}
