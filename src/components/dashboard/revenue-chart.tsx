'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/money';
import { useI18n } from '@/i18n/provider';

type Point = { day: string; cents: number };

/**
 * Ingresos diarios de la última semana.
 *
 * Serie única y días discretos → barras verticales, sin leyenda (el título ya
 * nombra la serie). El naranja de marca queda por debajo de 3:1 sobre blanco,
 * así que las cifras van escritas junto a las barras y no dependen del color.
 */
export function RevenueChart({
  title,
  series,
  currency,
  currencyDecimals,
}: {
  title: string;
  series: Point[];
  currency: string;
  currencyDecimals: number;
}) {
  const { locale } = useI18n();
  const [hovered, setHovered] = useState<number | null>(null);

  const data = series;
  const max = Math.max(...data.map((d) => d.cents), 1);
  const peakIndex = data.reduce((best, d, i) => (d.cents > data[best].cents ? i : best), 0);

  const dayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short' });
    return data.map((d) => fmt.format(new Date(`${d.day}T12:00:00`)));
  }, [data, locale]);


  const total = data.reduce((sum, d) => sum + d.cents, 0);

  if (data.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="font-display text-base font-bold text-ink-700">{title}</h2>
        <p className="py-12 text-center text-sm text-ink-300">—</p>
      </section>
    );
  }

  const CHART_HEIGHT = 168;
  const BAR_WIDTH = 26;
  const RADIUS = 4;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-chip">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-base font-bold text-ink-700">{title}</h2>
        <p className="font-display text-lg font-bold text-ink">
          {formatMoney(total, currency, currencyDecimals)}
        </p>
      </div>

      <div className="relative mt-6">
        {/* Rejilla de fondo, deliberadamente tenue */}
        <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: CHART_HEIGHT }}>
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className="block h-px w-full bg-surface-line/70" />
          ))}
        </div>

        <ul className="relative flex items-end justify-between gap-1" style={{ height: CHART_HEIGHT }}>
          {data.map((point, index) => {
            const ratio = point.cents / max;
            const height = Math.max(ratio * (CHART_HEIGHT - 26), point.cents > 0 ? 6 : 2);
            const isPeak = index === peakIndex && point.cents > 0;
            const isToday = index === data.length - 1;
            const showLabel = isPeak || isToday;

            return (
              <li
                key={point.day}
                className="relative flex flex-1 flex-col items-center justify-end"
                style={{ height: CHART_HEIGHT }}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
              >
                {showLabel && (
                  <span className="mb-1.5 whitespace-nowrap text-[10px] font-bold tabular-nums text-ink-500">
                    {formatMoney(point.cents, currency, currencyDecimals)}
                  </span>
                )}

                <button
                  type="button"
                  aria-label={`${dayLabels[index]}: ${formatMoney(point.cents, currency, currencyDecimals)}`}
                  className="w-full outline-none"
                  style={{ maxWidth: BAR_WIDTH }}
                >
                  <span
                    className="block w-full transition-colors"
                    style={{
                      height,
                      borderTopLeftRadius: RADIUS,
                      borderTopRightRadius: RADIUS,
                      backgroundColor:
                        point.cents === 0
                          ? '#E3DCD5'
                          : hovered === index
                            ? '#E2560E'
                            : '#FF7622',
                    }}
                  />
                </button>

                {hovered === index && point.cents > 0 && (
                  <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-bold text-white shadow-card">
                    {formatMoney(point.cents, currency, currencyDecimals)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Línea base */}
        <span className="block h-px w-full bg-surface-line" />

        <ul className="mt-2 flex justify-between gap-1">
          {dayLabels.map((label, index) => (
            <li
              key={data[index].day}
              className="flex-1 text-center text-[11px] font-semibold capitalize text-ink-300"
            >
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
