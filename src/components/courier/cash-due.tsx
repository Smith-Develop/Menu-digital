'use client';

import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { listCashDue, type CashDue } from '@/app/actions/delivery';
import { formatMoney } from '@/lib/money';
import { useT } from '@/i18n/provider';

/**
 * Efectivo que el repartidor lleva encima.
 *
 * Se agrupa por restaurante porque un repartidor trabaja para varios y a cada
 * uno le devuelve lo suyo. El saldo se acumula hasta que el local da el dinero
 * por recibido: hasta entonces esos pedidos siguen a la vista del restaurante.
 */
export function CashDuePanel({ currency, currencyDecimals }: { currency: string; currencyDecimals: number }) {
  const t = useT();
  const [pendiente, setPendiente] = useState<CashDue[] | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      listCashDue()
        .then((filas) => vivo && setPendiente(filas))
        .catch(() => vivo && setPendiente([]));

    void cargar();
    const temporizador = setInterval(cargar, 30_000);
    return () => {
      vivo = false;
      clearInterval(temporizador);
    };
  }, []);

  if (!pendiente || pendiente.length === 0) return null;

  const total = pendiente.reduce((suma, fila) => suma + fila.cents, 0);

  return (
    <section className="rounded-2xl bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-ink">
          <Wallet className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900">{t.courier.cashDue}</p>
          <p className="mt-0.5 text-xs text-amber-800/80">{t.courier.cashDueHint}</p>
        </div>
        <span className="shrink-0 font-display text-xl font-bold text-amber-900">
          {formatMoney(total, currency, currencyDecimals)}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {pendiente.map((fila) => (
          <li
            key={fila.restaurant_id}
            className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-semibold text-amber-900">
              {fila.restaurant_name}
            </span>
            <span className="shrink-0 text-xs text-amber-800/70">{fila.orders}</span>
            <span className="shrink-0 font-bold text-amber-900">
              {formatMoney(fila.cents, currency, currencyDecimals)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-center text-xs text-amber-800/70">{t.courier.settleAtRestaurant}</p>
    </section>
  );
}
