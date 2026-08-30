'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Bike,
  CalendarRange,
  Package,
  Receipt,
  Store,
  TrendingDown,
  TrendingUp,
  UtensilsCrossed,
} from 'lucide-react';
import { MetricTile, GrowBar } from '@/components/dashboard/metric-tile';
import { EmptyState } from '@/components/ui/misc';
import { formatMoney } from '@/lib/money';
import { useI18n } from '@/i18n/provider';
import { cn, initials } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type AnalyticsData = {
  orders: number;
  completed: number;
  revenue_cents: number;
  avg_ticket_cents: number;
  units: number;
  by_type: { type: Enums<'order_type'>; orders: number; cents: number }[];
  top_products: { name: string; image: string | null; units: number; revenue_cents: number }[];
  worst_products: { name: string; image: string | null; units: number; revenue_cents: number }[];
  series: { i: number; cents: number; orders: number }[];
};

const PRESETS = [1, 7, 30, 90] as const;

export function RestaurantAnalytics({
  data,
  currency,
  currencyDecimals,
  range,
  basePath = '/dashboard',
}: {
  data: AnalyticsData | null;
  currency: string;
  currencyDecimals: number;
  range: { days: number; custom: boolean; from: string; to: string };
  /** Ruta a la que apuntan los enlaces del selector de periodo. */
  basePath?: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();

  const [tab, setTab] = useState<'best' | 'worst'>('best');
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  const money = (cents: number) => formatMoney(Math.round(cents), currency, currencyDecimals);

  const LABELS: Record<number, string> = {
    1: t.analytics.today,
    7: t.analytics.week,
    30: t.analytics.month,
    90: t.analytics.quarter,
  };

  const TYPE_META: Record<Enums<'order_type'>, { icon: typeof Bike; label: string }> = {
    dine_in: { icon: UtensilsCrossed, label: t.cart.dineIn },
    delivery: { icon: Bike, label: t.cart.delivery },
    pickup: { icon: Store, label: t.cart.pickup },
  };

  if (!data) {
    return <EmptyState icon={<Receipt className="h-7 w-7" />} title={t.analytics.noData} />;
  }

  const products = tab === 'best' ? data.top_products : data.worst_products;
  const maxUnits = Math.max(...products.map((p) => p.units), 1);
  const maxDay = Math.max(...data.series.map((d) => d.cents), 1);
  const dayLabel = (offset: number) => {
    const date = new Date(`${range.from}T12:00:00`);
    date.setDate(date.getDate() + offset);
    return date.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="space-y-6">
      {/* Rango */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-300">
          <CalendarRange className="h-3.5 w-3.5" />
          {t.analytics.range}
        </span>

        <div className="flex gap-1 rounded-xl bg-surface-field p-1">
          {PRESETS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => router.push(`${basePath}?days=${days}`)}
              className={cn(
                'rounded-lg px-3.5 py-2 text-xs font-bold transition-colors',
                !range.custom && range.days === days ? 'bg-white text-ink shadow-sm' : 'text-ink-400 hover:text-ink',
              )}
            >
              {LABELS[days]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label={t.analytics.from}
            className="field w-auto py-2 text-xs"
          />
          <span className="text-xs text-ink-300">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label={t.analytics.to}
            className="field w-auto py-2 text-xs"
          />
          <button
            type="button"
            onClick={() => router.push(`${basePath}?from=${customFrom}&to=${customTo}`)}
            className="btn-primary text-xs"
          >
            {t.analytics.apply}
          </button>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t.analytics.revenue}
          value={data.revenue_cents}
          format={money}
          tone="success"
          icon={<TrendingUp className="h-4 w-4" />}
          delay={0}
        />
        <MetricTile
          label={t.analytics.orders}
          value={data.completed}
          hint={`${data.orders} ${t.analytics.ordersShort}`}
          tone="brand"
          icon={<Receipt className="h-4 w-4" />}
          delay={60}
        />
        <MetricTile
          label={t.analytics.avgTicket}
          value={data.avg_ticket_cents}
          format={money}
          tone="ink"
          icon={<Package className="h-4 w-4" />}
          delay={120}
        />
        <MetricTile
          label={t.analytics.units}
          value={data.units}
          tone="accent"
          icon={<UtensilsCrossed className="h-4 w-4" />}
          delay={180}
        />
      </div>

      {/* Evolución */}
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="mb-5 font-display text-base font-bold text-ink-700">
          {t.analytics.revenue}
        </h2>

        {data.series.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-300">{t.analytics.noData}</p>
        ) : (
          <>
            <ul className="flex h-40 items-end gap-1">
              {data.series.map((point, index) => {
                const height = Math.max((point.cents / maxDay) * 100, point.cents > 0 ? 4 : 1.5);
                return (
                  // El <li> necesita alto propio: sin él, el porcentaje de la
                  // barra se calcula sobre una caja de cero píxeles y no se ve nada.
                  <li key={point.i} className="group relative flex h-full flex-1 items-end">
                    <span
                      className="block w-full rounded-t bg-gradient-to-t from-brand-700 to-brand transition-[height] duration-700 ease-out"
                      style={{ height: `${height}%`, transitionDelay: `${Math.min(index * 12, 300)}ms` }}
                    />
                    <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[10px] font-bold text-white group-hover:block">
                      {dayLabel(point.i)} · {money(point.cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex justify-between text-[11px] text-ink-300">
              <span>{dayLabel(data.series[0].i)}</span>
              <span>{dayLabel(data.series[data.series.length - 1].i)}</span>
            </div>
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Modalidades */}
        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <h2 className="mb-4 font-display text-base font-bold text-ink-700">{t.cart.orderType}</h2>
          {data.by_type.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-300">{t.analytics.noData}</p>
          ) : (
            <ul className="space-y-3">
              {data.by_type.map((row) => {
                const { icon: Icon, label } = TYPE_META[row.type];
                const share = data.revenue_cents > 0 ? row.cents / data.revenue_cents : 0;
                return (
                  <li key={row.type}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="inline-flex items-center gap-2 font-semibold text-ink-600">
                        <Icon className="h-4 w-4 text-brand" />
                        {label}
                      </span>
                      <span className="text-ink-400">
                        {row.orders} · <span className="font-bold text-ink">{money(row.cents)}</span>
                      </span>
                    </div>
                    <GrowBar ratio={share} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Platos */}
        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-base font-bold text-ink-700">{t.analytics.products}</h2>
            <div className="flex gap-1 rounded-xl bg-surface-field p-1">
              {(
                [
                  ['best', t.analytics.bestSellers, TrendingUp],
                  ['worst', t.analytics.worstSellers, TrendingDown],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                    tab === key ? 'bg-white text-ink shadow-sm' : 'text-ink-400',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {products.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-300">{t.analytics.noData}</p>
          ) : (
            <ol className="space-y-3">
              {products.map((product, index) => (
                <li key={`${product.name}-${index}`} className="flex items-center gap-3">
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                    {product.image ? (
                      <Image src={product.image} alt="" fill sizes="36px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-ink-300">
                        {initials(product.name)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink-700">{product.name}</span>
                      <span className="shrink-0 text-xs text-ink-400">
                        {product.units} · <span className="font-bold text-ink">{money(product.revenue_cents)}</span>
                      </span>
                    </span>
                    <GrowBar ratio={product.units / maxUnits} tone={tab === 'worst' ? 'muted' : 'brand'} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
