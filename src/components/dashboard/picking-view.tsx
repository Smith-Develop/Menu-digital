'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Barcode,
  Bike,
  Check,
  CircleSlash,
  MinusCircle,
  PackageCheck,
  Repeat,
  Search,
  Store,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { pickOrderItem, replaceOrderItem, updateOrderStatus } from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type PickingOrder = {
  id: string;
  code: string;
  type: Enums<'order_type'>;
  status: Enums<'order_status'>;
  customerName: string | null;
  totalCents: number;
  currency: string;
  createdAt: string;
  scheduledFor: string | null;
  lines: number;
};

type Line = {
  id: string;
  name: string;
  image: string | null;
  notes: string | null;
  ordered_qty: number;
  quantity: number;
  picked_qty: number | null;
  picked_at: string | null;
  pick_note: string | null;
  replaced_from: { name?: string } | null;
  voided_at: string | null;
  unit: Enums<'sale_unit'> | null;
  barcode: string | null;
  brand: string | null;
  pack_size: string | null;
  stock_qty: number | null;
  aisle: string | null;
  aisle_position: number;
  shelf: string | null;
};

type Candidato = { id: string; name: string; price_cents: number; image_url: string | null };

/**
 * Preparar la compra.
 *
 * La pantalla de cocina enseña platos por hacer; ésta enseña estanterías por
 * recorrer, y por eso el orden no es el del pedido sino el del pasillo. Quien
 * prepara lleva el móvil en una mano y el carro en la otra: cada línea se
 * resuelve con un toque —está— y sólo cuesta más cuando la respuesta es que no
 * está, que es justo cuando hay que pensar.
 */
export function PickingView({
  restaurantId,
  orders,
}: {
  restaurantId: string;
  orders: PickingOrder[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [pedidos, setPedidos] = useState(orders);
  const [abierto, setAbierto] = useState<PickingOrder | null>(null);
  const [lineas, setLineas] = useState<Line[]>([]);
  const [cargando, setCargando] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  // Diálogos: recoger menos de lo pedido, y cambiar por otro.
  const [menos, setMenos] = useState<Line | null>(null);
  const [cuantos, setCuantos] = useState(1);
  const [cambiar, setCambiar] = useState<Line | null>(null);
  const [busca, setBusca] = useState('');
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);

  useEffect(() => setPedidos(orders), [orders]);

  const cargar = useCallback(
    async (orderId: string) => {
      setCargando(true);
      const { data } = await supabase.rpc('order_picking_list', { p_order_id: orderId });
      setLineas((data as unknown as Line[]) ?? []);
      setCargando(false);
    },
    [supabase],
  );

  async function abrir(pedido: PickingOrder) {
    setAbierto(pedido);
    setLineas([]);
    await cargar(pedido.id);
  }

  /** Una línea está resuelta cuando ya se sabe qué se lleva de ella. */
  const resuelta = (l: Line) => l.picked_at !== null || l.voided_at !== null;
  const hechas = lineas.filter(resuelta).length;
  const listas = lineas.length > 0 && hechas === lineas.length;

  async function recoger(linea: Line, qty: number, nota?: string) {
    setTrabajando(linea.id);
    const result = await pickOrderItem(linea.id, qty, nota);
    setTrabajando(null);

    if (!result.ok) {
      toast(
        result.error === 'NOTHING_PICKED' ? t.picking.nothingPicked : t.common.error,
        'error',
      );
      return;
    }
    if (result.data.refundedCents > 0 && abierto) {
      toast(
        interpolate(t.picking.refunded, {
          amount: formatMoney(result.data.refundedCents, abierto.currency),
        }),
        'success',
      );
    }
    setMenos(null);
    if (abierto) await cargar(abierto.id);
  }

  async function sustituir(linea: Line, producto: Candidato) {
    setTrabajando(linea.id);
    const result = await replaceOrderItem(linea.id, producto.id, null, busca);
    setTrabajando(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setCambiar(null);
    setBusca('');
    if (abierto) await cargar(abierto.id);
  }

  /** Buscar el sustituto. En una tienda con miles de referencias, se busca. */
  useEffect(() => {
    if (!cambiar) return;
    const termino = busca.trim();
    const id = setTimeout(async () => {
      const consulta = supabase
        .from('products')
        .select('id, name, price_cents, image_url')
        .eq('restaurant_id', restaurantId)
        .eq('is_available', true)
        .order('name')
        .limit(20);
      const { data } = termino
        ? await consulta.or(`name.ilike.%${termino}%,barcode.eq.${termino}`)
        : await consulta;
      setCandidatos(data ?? []);
    }, 250);
    return () => clearTimeout(id);
  }, [busca, cambiar, restaurantId, supabase]);

  async function terminar() {
    if (!abierto) return;
    setTrabajando('fin');
    const result = await updateOrderStatus(abierto.id, 'ready');
    setTrabajando(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setPedidos((p) => p.filter((o) => o.id !== abierto.id));
    setAbierto(null);
  }

  // --------------------------------------------------------------
  if (abierto) {
    // Las cabeceras de pasillo se calculan al vuelo: la consulta ya devuelve
    // las líneas en el orden del recorrido, así que basta con mirar si el
    // pasillo cambió respecto a la anterior.
    let pasilloAnterior: string | null = null;

    return (
      <div className="space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setAbierto(null)} className="icon-btn h-10 w-10">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-bold text-ink">#{abierto.code}</h1>
            <p className="text-xs text-ink-300">
              {abierto.customerName} ·{' '}
              {interpolate(t.picking.progress, { done: hechas, total: lineas.length })}
            </p>
          </div>
          <span className="shrink-0 font-display text-lg font-bold tabular-nums text-ink">
            {formatMoney(abierto.totalCents, abierto.currency)}
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-surface-field">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: lineas.length ? `${(hechas / lineas.length) * 100}%` : '0%' }}
          />
        </div>

        {cargando && <p className="py-10 text-center text-sm text-ink-300">{t.common.loading}</p>}

        <ul className="space-y-2">
          {lineas.map((l) => {
            const cabecera = l.aisle !== pasilloAnterior ? l.aisle : null;
            pasilloAnterior = l.aisle;
            const falta = l.voided_at !== null;
            const menosDeLoPedido = !falta && l.picked_at !== null && l.quantity < l.ordered_qty;

            return (
              <li key={l.id}>
                {cabecera !== null && (
                  <p className="label mb-2 mt-5 first:mt-0">{cabecera}</p>
                )}
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-2xl bg-white p-3 shadow-chip transition-opacity',
                    resuelta(l) && 'opacity-60',
                  )}
                >
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-field">
                    {l.image && (
                      <Image src={l.image} alt="" fill sizes="56px" className="object-cover" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-sm font-bold text-ink-700',
                        falta && 'line-through',
                      )}
                    >
                      {l.ordered_qty}× {l.name}
                    </p>
                    <p className="truncate text-xs text-ink-300">
                      {[l.brand, l.pack_size, l.shelf].filter(Boolean).join(' · ')}
                    </p>
                    {l.notes && <p className="mt-0.5 text-xs text-ink-400">{l.notes}</p>}

                    {l.replaced_from?.name && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        <Repeat className="h-3 w-3" />
                        {interpolate(t.picking.replacedFrom, { name: l.replaced_from.name })}
                      </p>
                    )}
                    {falta && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-state-danger/10 px-2 py-0.5 text-[11px] font-semibold text-state-danger">
                        <CircleSlash className="h-3 w-3" />
                        {t.picking.outOfStock}
                      </p>
                    )}
                    {menosDeLoPedido && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        {interpolate(t.picking.lessThanOrdered, {
                          picked: l.quantity,
                          ordered: l.ordered_qty,
                        })}
                      </p>
                    )}
                    {l.barcode && (
                      <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-ink-300">
                        <Barcode className="h-3 w-3" />
                        {l.barcode}
                      </p>
                    )}
                  </div>

                  {!resuelta(l) && (
                    <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                      <button
                        type="button"
                        disabled={trabajando === l.id}
                        onClick={() => recoger(l, l.ordered_qty)}
                        className="btn-primary px-3 py-2 text-xs disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t.picking.pick}
                      </button>
                      <div className="flex gap-1.5">
                        {l.ordered_qty > 1 && (
                          <button
                            type="button"
                            title={t.picking.partial}
                            onClick={() => {
                              setMenos(l);
                              setCuantos(Math.max(l.ordered_qty - 1, 1));
                            }}
                            className="btn-soft flex-1 px-2 py-1.5 text-xs"
                          >
                            <MinusCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title={t.picking.substitute}
                          onClick={() => {
                            setCambiar(l);
                            setBusca('');
                          }}
                          className="btn-soft flex-1 px-2 py-1.5 text-xs"
                        >
                          <Repeat className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title={t.picking.missing}
                          disabled={trabajando === l.id}
                          onClick={() => recoger(l, 0, t.picking.outOfStock)}
                          className="btn-danger flex-1 px-2 py-1.5 text-xs disabled:opacity-50"
                        >
                          <CircleSlash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="bottom-bar">
          <Button
            size="block"
            loading={trabajando === 'fin'}
            disabled={!listas}
            onClick={terminar}
          >
            <PackageCheck className="h-4 w-4" />
            {t.picking.finish}
          </Button>
        </div>

        {/* Recoger menos de lo pedido. */}
        <Sheet open={menos !== null} onClose={() => setMenos(null)} title={t.picking.howMany}>
          {menos && (
            <div className="space-y-5">
              <p className="text-sm text-ink-400">
                {menos.ordered_qty}× {menos.name}
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: menos.ordered_qty }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCuantos(n)}
                    className={cn(
                      'h-12 w-12 rounded-xl font-display text-base font-bold tabular-nums transition-colors',
                      n === cuantos
                        ? 'bg-brand text-white'
                        : 'bg-surface-field text-ink-500 hover:bg-surface-muted',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button
                size="block"
                loading={trabajando === menos.id}
                onClick={() => recoger(menos, cuantos, t.picking.outOfStock)}
              >
                {t.picking.pick}
              </Button>
            </div>
          )}
        </Sheet>

        {/* Cambiarlo por otro. */}
        <Sheet
          open={cambiar !== null}
          onClose={() => setCambiar(null)}
          title={t.picking.substitute}
          size="lg"
        >
          {cambiar && (
            <div className="space-y-4">
              <p className="rounded-xl bg-surface-soft px-4 py-3 text-xs text-ink-400">
                {t.picking.never}
              </p>
              <Input
                autoFocus
                icon={<Search className="h-4 w-4" />}
                placeholder={t.picking.searchReplacement}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <ul className="divide-y divide-surface-line">
                {candidatos
                  .filter((c) => c.id !== cambiar.id)
                  .map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={trabajando === cambiar.id}
                        onClick={() => sustituir(cambiar, c)}
                        className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-50"
                      >
                        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-surface-field">
                          {c.image_url && (
                            <Image
                              src={c.image_url}
                              alt=""
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-700">
                          {c.name}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-ink-400">
                          {formatMoney(c.price_cents, abierto.currency)}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Sheet>
      </div>
    );
  }

  // --------------------------------------------------------------
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.picking.title}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.picking.subtitle}</p>
      </div>

      {pedidos.length === 0 ? (
        <p className="rounded-2xl bg-white py-16 text-center text-sm text-ink-300 shadow-chip">
          {t.picking.noOrders}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pedidos.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => abrir(o)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-chip transition-shadow hover:shadow-card"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-field text-ink-400">
                  {o.type === 'delivery' ? (
                    <Bike className="h-5 w-5" />
                  ) : (
                    <Store className="h-5 w-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base font-bold text-ink">#{o.code}</span>
                  <span className="block truncate text-xs text-ink-300">
                    {o.customerName} · {interpolate(t.picking.lines, { n: o.lines })}
                  </span>
                  {o.scheduledFor && (
                    <span className="mt-1 block text-xs font-semibold text-brand-700">
                      {new Date(o.scheduledFor).toLocaleString(locale, {
                        weekday: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                  {formatMoney(o.totalCents, o.currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
