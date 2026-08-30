'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import {
  Bike,
  Building2,
  LayoutGrid,
  MapPin,
  Package,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { useI18n } from '@/i18n/provider';
import { cn, initials } from '@/lib/utils';

export type PlatformStats = {
  restaurants_total: number;
  restaurants_active: number;
  orders: number;
  revenue_cents: number;
  avg_ticket_cents: number;
  couriers_total: number;
  top_restaurants: { name: string; slug: string; city: string | null; logo_url: string | null; orders: number; revenue_cents: number }[];
  top_couriers: { name: string; avatar_url: string | null; vehicle: string; deliveries: number }[];
  top_cities: { city: string; orders: number; revenue_cents: number; restaurants: number }[];
  top_categories: { name: string; slug: string; units: number; revenue_cents: number }[];
  best_products: { name: string; image: string | null; restaurant: string; units: number; revenue_cents: number }[];
  worst_products: { name: string; image: string | null; restaurant: string; units: number; revenue_cents: number }[];
  never_ordered: { name: string; image: string | null; restaurant: string }[];
  revenue_series: { day: string; cents: number }[];
};

/**
 * Cuadro de mando de la plataforma.
 *
 * Cada bloque es una lista ordenada con su barra de proporción respecto al
 * primero: comparar de un vistazo importa más que el valor exacto, que se lee
 * al lado.
 */
export function AnalyticsBoard({ stats, days }: { stats: PlatformStats; days: number }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'best' | 'worst' | 'never'>('best');

  const products =
    tab === 'best' ? stats.best_products : tab === 'worst' ? stats.worst_products : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t.analytics.revenue} value={formatMoney(stats.revenue_cents, 'EUR')} tone="success" />
        <Metric label={t.analytics.orders} value={String(stats.orders)} tone="brand" />
        <Metric label={t.analytics.avgTicket} value={formatMoney(stats.avg_ticket_cents, 'EUR')} />
        <Metric
          label={t.admin.restaurants}
          value={`${stats.restaurants_active}/${stats.restaurants_total}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel icon={<Building2 className="h-4 w-4" />} title={t.analytics.topRestaurants}>
          <Ranking
            rows={stats.top_restaurants.map((r) => ({
              key: r.slug,
              label: r.name,
              meta: [r.city, `${r.orders} ${t.analytics.ordersShort}`].filter(Boolean).join(' · '),
              value: r.revenue_cents,
              display: formatMoney(r.revenue_cents, 'EUR'),
              image: r.logo_url,
              href: `/r/${r.slug}`,
            }))}
            empty={t.analytics.noData}
          />
        </Panel>

        <Panel icon={<Bike className="h-4 w-4" />} title={t.analytics.topCouriers}>
          <Ranking
            rows={stats.top_couriers.map((c) => ({
              key: c.name,
              label: c.name,
              meta: c.vehicle,
              value: c.deliveries,
              display: `${c.deliveries} ${t.courier.deliveries}`,
              image: c.avatar_url,
            }))}
            empty={t.analytics.noData}
          />
        </Panel>

        <Panel icon={<MapPin className="h-4 w-4" />} title={t.analytics.topCities}>
          <Ranking
            rows={stats.top_cities.map((c) => ({
              key: c.city,
              label: c.city,
              meta: `${c.restaurants} ${t.admin.restaurants.toLowerCase()} · ${c.orders} ${t.analytics.ordersShort}`,
              value: c.revenue_cents,
              display: formatMoney(c.revenue_cents, 'EUR'),
            }))}
            empty={t.analytics.noData}
          />
        </Panel>

        <Panel icon={<LayoutGrid className="h-4 w-4" />} title={t.analytics.topCategories}>
          <Ranking
            rows={stats.top_categories.map((c) => ({
              key: c.slug,
              label: c.name,
              meta: `${c.units} ${t.analytics.units}`,
              value: c.revenue_cents,
              display: formatMoney(c.revenue_cents, 'EUR'),
              href: `/search?cat=${c.slug}`,
            }))}
            empty={t.analytics.noData}
          />
        </Panel>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
            <Package className="h-4 w-4 text-brand" />
            {t.analytics.products}
          </h2>
          <div className="flex gap-1 rounded-xl bg-surface-field p-1">
            {(
              [
                ['best', t.analytics.bestSellers, TrendingUp],
                ['worst', t.analytics.worstSellers, TrendingDown],
                ['never', t.analytics.neverOrdered, Package],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors',
                  tab === key ? 'bg-white text-ink shadow-sm' : 'text-ink-400',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'never' ? (
          stats.never_ordered.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-300">{t.analytics.allSold}</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-300">{t.analytics.neverOrderedHint}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {stats.never_ordered.map((p) => (
                  <li
                    key={`${p.restaurant}-${p.name}`}
                    className="flex items-center gap-3 rounded-xl bg-surface-field px-3 py-2.5"
                  >
                    <Thumb src={p.image} alt={p.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-700">{p.name}</span>
                      <span className="block truncate text-xs text-ink-300">{p.restaurant}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <Ranking
            rows={products.map((p) => ({
              key: `${p.restaurant}-${p.name}`,
              label: p.name,
              meta: p.restaurant,
              value: p.units,
              display: `${p.units} · ${formatMoney(p.revenue_cents, 'EUR')}`,
              image: p.image,
            }))}
            empty={t.analytics.noData}
            tone={tab === 'worst' ? 'muted' : 'brand'}
          />
        )}
      </section>

      <p className="text-center text-xs text-ink-300">
        {t.analytics.periodNote.replace('{n}', String(days))}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'brand' | 'success';
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-chip">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-300">{label}</p>
      <p
        className={cn(
          'mt-2 font-display text-2xl font-bold',
          tone === 'success' ? 'text-emerald-700' : tone === 'brand' ? 'text-brand' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-chip">
      <h2 className="mb-4 flex items-center gap-2 font-display text-base font-bold text-ink-700">
        <span className="text-brand">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return (
    <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
      {src ? (
        <Image src={src} alt="" fill sizes="36px" className="object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-ink-300">
          {initials(alt)}
        </span>
      )}
    </span>
  );
}

type Row = {
  key: string;
  label: string;
  meta?: string;
  value: number;
  display: string;
  image?: string | null;
  href?: string;
};

/** Lista ordenada con barra proporcional al primero de la lista. */
function Ranking({
  rows,
  empty,
  tone = 'brand',
}: {
  rows: Row[];
  empty: string;
  tone?: 'brand' | 'muted';
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-300">{empty}</p>;
  }

  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ol className="stagger space-y-2.5">
      {rows.map((row, index) => {
        const body = (
          <>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-field text-[11px] font-bold text-ink-400">
              {index + 1}
            </span>
            {row.image !== undefined && <Thumb src={row.image} alt={row.label} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-700">{row.label}</span>
              {row.meta && <span className="block truncate text-xs text-ink-300">{row.meta}</span>}
              <span
                className={cn(
                  'mt-1.5 block h-1.5 rounded-full transition-all duration-500',
                  tone === 'brand' ? 'bg-brand' : 'bg-ink-200',
                )}
                style={{ width: `${Math.max((row.value / max) * 100, 4)}%` }}
              />
            </span>
            <span className="shrink-0 text-sm font-bold text-ink">{row.display}</span>
          </>
        );

        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                className="flex items-center gap-3 rounded-xl px-1 py-1 transition-colors hover:bg-surface-soft"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-1 py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
