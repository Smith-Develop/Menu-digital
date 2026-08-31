'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BellRing, Plus, UserRound, Users } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { assignTableWaiter } from '@/app/dashboard/actions';
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
  orders: {
    id: string;
    code: string;
    status: string;
    payment_status: string;
    total_cents: number;
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
}: {
  tables: FloorTable[];
  waiters: { id: string; name: string }[];
  currency: string;
  currencyDecimals: number;
  slug: string;
  canAssign: boolean;
  currentUserId: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // La sala cambia sin que nadie toque esta pantalla: entran pedidos y avisos.
  useEffect(() => {
    const temporizador = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(temporizador);
  }, [router]);

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
    return <EmptyState icon={<Users className="h-7 w-7" />} title={t.floor.noTables} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Resumen valor={ocupadas.length} etiqueta={t.floor.busy} tono="brand" />
        <Resumen valor={libres.length} etiqueta={t.floor.free} tono="success" />
        <Resumen valor={mias.length} etiqueta={t.floor.mine} tono="neutral" />
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tables.map((mesa) => {
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
                    <span className="font-semibold text-ink-500">{t.common.total}</span>
                    <span className="font-bold text-ink">
                      {formatMoney(mesa.total_cents, currency, currencyDecimals)}
                    </span>
                  </div>
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

                {/* Pedir por el cliente: se abre la carta ya situada en la mesa. */}
                <Link href={`/m/${mesa.code}`} className="btn-ghost w-full text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  {t.floor.orderForTable}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
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
