'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  ChefHat,
  Check,
  Maximize,
  Store,
  UtensilsCrossed,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { updateOrderStatus } from '@/app/dashboard/actions';
import { minutesSince, formatTime, cn } from '@/lib/utils';
import { playSound, unlockAudio, type SoundSettings } from '@/lib/sounds';
import { useI18n, interpolate } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type KitchenTicket = {
  id: string;
  code: string;
  type: Enums<'order_type'>;
  status: Enums<'order_status'>;
  tableName: string | null;
  notes: string | null;
  createdAt: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    options: string[];
    notes: string | null;
    status: Enums<'order_item_status'>;
  }[];
};

const TYPE_ICON: Record<Enums<'order_type'>, typeof Bike> = {
  dine_in: UtensilsCrossed,
  delivery: Bike,
  pickup: Store,
};

/** Columnas del tablero. `pending` y `confirmed` comparten la de "en cola". */
const COLUMNS: { key: 'queue' | 'preparing' | 'ready'; statuses: Enums<'order_status'>[] }[] = [
  { key: 'queue', statuses: ['pending', 'confirmed'] },
  { key: 'preparing', statuses: ['preparing'] },
  { key: 'ready', statuses: ['ready'] },
];

/**
 * Pantalla de cocina, pensada para un monitor fijo: fondo oscuro, tipografía
 * grande, columnas por estado y un color de urgencia que sube con los minutos.
 */
export function KitchenDisplay({
  restaurantId,
  restaurantName,
  initialTickets,
  sounds,
}: {
  restaurantId: string;
  restaurantName: string;
  initialTickets: KitchenTicket[];
  sounds: SoundSettings;
}) {
  const { t, locale } = useI18n();
  const [tickets, setTickets] = useState(initialTickets);
  const [sound, setSound] = useState(true);
  // `null` hasta que la pantalla está montada en el navegador. Los minutos
  // transcurridos no pueden calcularse durante el pintado del servidor: se
  // haría en un instante distinto al de la hidratación y React descartaría el
  // árbol entero por texto que no coincide. Además hace de reloj: al avanzar
  // cada 30 s, los contadores suben solos.
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /*
   * Los navegadores no dejan sonar nada hasta que alguien toca la pantalla.
   * En una cocina eso significa que la primera comanda entraría muda, así que
   * se avisa hasta que el personal desbloquea el audio con un toque.
   */
  const [audioReady, setAudioReady] = useState(false);

  useEffect(() => {
    if (!sound) return;
    const enable = () => {
      unlockAudio();
      setAudioReady(true);
    };
    window.addEventListener('pointerdown', enable, { once: true });
    window.addEventListener('keydown', enable, { once: true });
    return () => {
      window.removeEventListener('pointerdown', enable);
      window.removeEventListener('keydown', enable);
    };
  }, [sound]);

  const notify = useCallback(
    (kind: 'newOrder' | 'orderReady') => {
      if (!sound || !sounds.enabled) return;
      playSound(sounds[kind], sounds.volume);
    },
    [sound, sounds],
  );

  const refetch = useCallback(async (orderId: string) => {
    const supabase = createClient();
    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (!order) return;

    const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
    let tableName: string | null = null;
    if (order.table_id) {
      const { data: table } = await supabase.from('tables').select('name').eq('id', order.table_id).maybeSingle();
      tableName = table?.name ?? null;
    }

    const ticket: KitchenTicket = {
      id: order.id,
      code: order.code,
      type: order.type,
      status: order.status,
      tableName,
      notes: order.notes,
      createdAt: order.created_at,
      items: (items ?? []).map((i) => ({
        id: i.id,
        name: i.name_snapshot,
        quantity: i.quantity,
        options: Array.isArray(i.options) ? (i.options as { name: string }[]).map((o) => o.name) : [],
        notes: i.notes,
        status: i.status,
      })),
    };

    setTickets((current) => {
      const live: Enums<'order_status'>[] = ['pending', 'confirmed', 'preparing', 'ready'];
      const without = current.filter((x) => x.id !== ticket.id);
      if (!live.includes(ticket.status)) return without;
      return [...without, ticket].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`kitchen-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
          if (!id) return;
          if (payload.eventType === 'INSERT') notify('newOrder');
          else if ((payload.new as { status?: string })?.status === 'ready') notify('orderReady');
          void refetch(id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurantId, refetch, notify]);

  async function advance(ticket: KitchenTicket) {
    const next: Enums<'order_status'> =
      ticket.status === 'pending' || ticket.status === 'confirmed'
        ? 'preparing'
        : ticket.status === 'preparing'
          ? 'ready'
          : 'completed';

    // Por la acción de servidor, no escribiendo la tabla desde aquí: es la que
    // avisa al móvil del cliente del cambio de estado. Actualizar en directo se
    // saltaría ese aviso sin que nada fallara a la vista.
    await updateOrderStatus(ticket.id, next);
    if (next === 'ready') notify('orderReady');
    await refetch(ticket.id);
  }

  const LABEL: Record<'queue' | 'preparing' | 'ready', string> = {
    queue: t.kitchen.queue,
    preparing: t.kitchen.preparing,
    ready: t.kitchen.ready,
  };

  const ACTION: Record<'queue' | 'preparing' | 'ready', string> = {
    queue: t.kitchen.startPreparing,
    preparing: t.kitchen.markReady,
    ready: t.kitchen.markServed,
  };

  return (
    <div className="min-h-dvh bg-ink text-white">
      <header className="flex flex-wrap items-center gap-4 border-b border-white/10 px-6 py-4">
        <Link href="/dashboard" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10" aria-label={t.common.back}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold">
            <ChefHat className="h-5 w-5 text-brand" />
            {t.kitchen.title}
          </h1>
          <p className="text-xs text-white/50">{restaurantName}</p>
        </div>

        <button
          type="button"
          onClick={() => setSound((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          aria-label={sound ? t.kitchen.soundOn : t.kitchen.soundOff}
          title={sound ? t.kitchen.soundOn : t.kitchen.soundOff}
        >
          {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 text-white/40" />}
        </button>
        <button
          type="button"
          onClick={() => document.documentElement.requestFullscreen?.()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
          aria-label={t.kitchen.fullscreen}
          title={t.kitchen.fullscreen}
        >
          <Maximize className="h-5 w-5" />
        </button>
      </header>

      {sound && sounds.enabled && !audioReady && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setAudioReady(true);
            playSound(sounds.newOrder, sounds.volume);
          }}
          className="flex w-full items-center justify-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-bold text-ink"
        >
          <Volume2 className="h-4 w-4" />
          {t.kitchen.enableSound}
        </button>
      )}

      <div className="grid gap-4 p-4 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnTickets = tickets.filter((ticket) => column.statuses.includes(ticket.status));

          return (
            <section key={column.key} className="rounded-2xl bg-white/[0.04] p-4">
              <h2 className="mb-4 flex items-center justify-between text-sm font-bold uppercase tracking-wide text-white/60">
                {LABEL[column.key]}
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white">
                  {columnTickets.length}
                </span>
              </h2>

              {columnTickets.length === 0 ? (
                <p className="py-10 text-center text-sm text-white/30">{t.kitchen.noTickets}</p>
              ) : (
                <ul className="space-y-3">
                  {columnTickets.map((ticket) => {
                    const elapsed = ahora === null ? 0 : minutesSince(ticket.createdAt);
                    const TypeIcon = TYPE_ICON[ticket.type];
                    const urgency =
                      elapsed > 25
                        ? 'border-red-500 bg-red-500/10'
                        : elapsed > 15
                          ? 'border-amber-400 bg-amber-400/10'
                          : 'border-white/10 bg-white/[0.06]';

                    return (
                      <li key={ticket.id} className={cn('rounded-xl border-l-4 p-4', urgency)}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display text-2xl font-bold">#{ticket.code}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/50">
                              <TypeIcon className="h-3.5 w-3.5" />
                              {ticket.tableName ??
                                (ticket.type === 'delivery' ? t.cart.delivery : t.cart.pickup)}
                              <span>·</span>
                              {formatTime(ticket.createdAt, locale)}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-3 py-1 text-xs font-bold tabular-nums',
                              elapsed > 25
                                ? 'bg-red-500 text-white'
                                : elapsed > 15
                                  ? 'bg-amber-400 text-ink'
                                  : 'bg-white/15 text-white',
                            )}
                          >
                            {ahora === null ? '' : interpolate(t.kitchen.elapsed, { n: elapsed })}
                          </span>
                        </div>

                        <ul className="mt-4 space-y-2.5">
                          {ticket.items.map((item) => (
                            <li key={item.id} className="flex gap-3">
                              <span className="font-display text-lg font-bold text-brand">
                                {item.quantity}×
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-base font-semibold leading-tight">
                                  {item.name}
                                </span>
                                {item.options.length > 0 && (
                                  <span className="block text-sm text-white/50">
                                    {item.options.join(' · ')}
                                  </span>
                                )}
                                {item.notes && (
                                  <span className="mt-1 block rounded bg-amber-400/20 px-2 py-1 text-sm font-semibold text-amber-200">
                                    {item.notes}
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>

                        {ticket.notes && (
                          <p className="mt-3 rounded-lg bg-amber-400/20 px-3 py-2 text-sm text-amber-200">
                            {ticket.notes}
                          </p>
                        )}

                        <button
                          type="button"
                          onClick={() => advance(ticket)}
                          className={cn(
                            'mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold uppercase tracking-wide transition-transform active:scale-[0.98]',
                            column.key === 'ready'
                              ? 'bg-state-success text-white'
                              : 'bg-brand text-white',
                          )}
                        >
                          <Check className="h-4 w-4" />
                          {ACTION[column.key]}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
