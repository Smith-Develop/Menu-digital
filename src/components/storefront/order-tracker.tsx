'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Bike,
  Check,
  ChefHat,
  ClipboardCheck,
  Clock,
  PackageCheck,
  Phone,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { ScreenHeader, Badge } from '@/components/ui/misc';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type TrackedOrder = {
  id: string;
  code: string;
  type: Enums<'order_type'>;
  status: Enums<'order_status'>;
  payment_method: Enums<'payment_method'>;
  payment_status: Enums<'payment_status'>;
  currency: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  notes: string | null;
  address: string | null;
  created_at: string;
  restaurant: {
    name: string;
    slug: string;
    logo_url: string | null;
    phone: string | null;
    address: string | null;
    currency_decimals: number;
    avg_prep_minutes: number;
  };
  table: { name: string; code: string } | null;
  items: {
    name: string;
    image: string | null;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    options: { name: string; group: string }[];
    status: Enums<'order_item_status'>;
    notes: string | null;
  }[];
  events: { status: Enums<'order_status'>; at: string }[];
};

/** Pasos que ve el cliente. `delivering` sólo aplica a pedidos a domicilio. */
const STEPS: { status: Enums<'order_status'>; icon: typeof Check }[] = [
  { status: 'pending', icon: ClipboardCheck },
  { status: 'confirmed', icon: Check },
  { status: 'preparing', icon: ChefHat },
  { status: 'ready', icon: PackageCheck },
  { status: 'delivering', icon: Bike },
  { status: 'completed', icon: ShoppingBag },
];

export function OrderTracker({ order: initial, token }: { order: TrackedOrder; token: string }) {
  const { t, locale } = useI18n();
  const [order, setOrder] = useState(initial);

  // Sondeo cada 15 s: el pedido es anónimo, así que no hay canal Realtime con RLS.
  useEffect(() => {
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data } = await supabase.rpc('get_order_by_token', { p_token: token });
      if (data) setOrder(data as unknown as TrackedOrder);
    }, 15_000);
    return () => clearInterval(id);
  }, [token]);

  const decimals = order.restaurant.currency_decimals;
  const cancelled = order.status === 'cancelled';

  const steps = STEPS.filter(
    (step) => step.status !== 'delivering' || order.type === 'delivery',
  );
  const currentIndex = steps.findIndex((s) => s.status === order.status);
  const doneAt = new Map(order.events.map((e) => [e.status, e.at]));

  return (
    <div className="mobile-shell pb-10">
      <ScreenHeader title={t.order.trackTitle} backHref={`/r/${order.restaurant.slug}`} />

      <div className="px-5">
        <div className="rounded-2xl bg-ink px-5 py-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-white/60">
                {t.order.orderCode}
              </p>
              <p className="mt-1 font-display text-2xl font-bold">#{order.code}</p>
            </div>
            <Badge tone={cancelled ? 'danger' : order.status === 'completed' ? 'success' : 'onDark'}>
              {t.order.status[order.status]}
            </Badge>
          </div>

          <p className="mt-4 text-sm text-white/70">{t.order.statusHint[order.status]}</p>

          {!cancelled && order.status !== 'completed' && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-bold">
              <Clock className="h-3.5 w-3.5" />
              {t.order.estimatedTime}: ~{order.restaurant.avg_prep_minutes} {t.common.min}
            </p>
          )}
        </div>

        {/* Línea de tiempo */}
        {cancelled ? (
          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-4 text-red-700">
            <XCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-semibold">{t.order.statusHint.cancelled}</p>
          </div>
        ) : (
          <ol className="mt-7 space-y-0">
            {steps.map((step, index) => {
              const reached = currentIndex >= index;
              const isCurrent = currentIndex === index;
              const Icon = step.icon;
              const at = doneAt.get(step.status);
              const isLast = index === steps.length - 1;

              return (
                <li key={step.status} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                        reached ? 'bg-brand text-white' : 'bg-surface-muted text-ink-200',
                        isCurrent && 'ring-4 ring-brand/20',
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    {!isLast && (
                      <span
                        className={cn(
                          'w-0.5 flex-1 transition-colors',
                          currentIndex > index ? 'bg-brand' : 'bg-surface-line',
                        )}
                      />
                    )}
                  </div>

                  <div className={cn('pb-7', isLast && 'pb-0')}>
                    <p
                      className={cn(
                        'text-[15px] font-bold',
                        reached ? 'text-ink-700' : 'text-ink-200',
                      )}
                    >
                      {t.order.status[step.status]}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-300">
                      {at ? formatDateTime(at, locale) : t.order.statusHint[step.status]}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Restaurante */}
        <section className="mt-7 flex items-center gap-3 rounded-2xl bg-surface-field p-4">
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
            {order.restaurant.logo_url && (
              <Image
                src={order.restaurant.logo_url}
                alt={order.restaurant.name}
                fill
                sizes="48px"
                className="object-cover"
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink-700">{order.restaurant.name}</p>
            <p className="mt-0.5 truncate text-xs text-ink-300">
              {/* El nombre de la mesa ya incluye la palabra "Mesa": no la repetimos. */}
              {order.table ? order.table.name : (order.address ?? order.restaurant.address)}
            </p>
          </div>
          {order.restaurant.phone && (
            <a
              href={`tel:${order.restaurant.phone}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white"
              aria-label={order.restaurant.phone}
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
        </section>

        {/* Líneas */}
        <section className="mt-7">
          <h2 className="section-title mb-3">{t.order.orderCode}</h2>
          <ul className="divide-y divide-surface-line">
            {order.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-center gap-3 py-3">
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                  {item.image ? (
                    <Image src={item.image} alt={item.name} fill sizes="56px" className="object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-200">
                      <ShoppingBag className="h-5 w-5" />
                    </span>
                  )}
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">
                    {item.quantity}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-700">{item.name}</p>
                  {item.options.length > 0 && (
                    <p className="truncate text-xs text-ink-300">
                      {item.options.map((o) => o.name).join(' · ')}
                    </p>
                  )}
                  {item.notes && <p className="truncate text-xs italic text-ink-300">“{item.notes}”</p>}
                </div>
                <span className="shrink-0 text-sm font-bold text-ink-600">
                  {formatMoney(item.line_total_cents, order.currency, decimals)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Totales */}
        <section className="mt-6 rounded-2xl bg-surface-field p-5">
          <dl className="space-y-2 text-sm">
            <Row label={t.common.subtotal} value={formatMoney(order.subtotal_cents, order.currency, decimals)} />
            {order.delivery_fee_cents > 0 && (
              <Row label={t.common.delivery} value={formatMoney(order.delivery_fee_cents, order.currency, decimals)} />
            )}
            {order.tax_cents > 0 && (
              <Row label={t.common.taxes} value={formatMoney(order.tax_cents, order.currency, decimals)} />
            )}
            {order.tip_cents > 0 && (
              <Row label={t.common.tip} value={formatMoney(order.tip_cents, order.currency, decimals)} />
            )}
          </dl>
          <div className="mt-4 flex items-center justify-between border-t border-surface-line pt-4">
            <span className="text-xs font-bold uppercase tracking-wide text-ink-300">
              {t.common.total}
            </span>
            <span className="font-display text-xl font-bold text-ink">
              {formatMoney(order.total_cents, order.currency, decimals)}
            </span>
          </div>
          <p className="mt-3 text-xs text-ink-300">
            {t.checkout.paymentMethod}:{' '}
            <span className="font-semibold text-ink-600">
              {order.payment_method === 'cash'
                ? t.checkout.cash
                : order.payment_method === 'tpv'
                  ? t.checkout.tpv
                  : t.checkout.card}
            </span>{' '}
            · {t.order.payment[order.payment_status]}
          </p>
        </section>

        <Link href={`/r/${order.restaurant.slug}`} className="btn-ghost mt-6 w-full">
          {t.storefront.viewMenu}
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-semibold text-ink-600">{value}</dd>
    </div>
  );
}
