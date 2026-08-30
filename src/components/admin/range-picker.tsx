'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

const PRESETS = [1, 7, 30, 90] as const;

/** Selector de periodo: escribe el rango en la URL para que sea compartible. */
export function RangePicker({ current, basePath }: { current: number; basePath?: string }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();

  const LABELS: Record<number, string> = {
    1: t.analytics.today,
    7: t.analytics.week,
    30: t.analytics.month,
    90: t.analytics.quarter,
  };

  function pick(days: number) {
    const next = new URLSearchParams(params.toString());
    next.set('days', String(days));
    router.push(`${basePath ?? ''}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-300">
        <CalendarRange className="h-3.5 w-3.5" />
        {t.analytics.range}
      </span>
      <div className="flex gap-1 rounded-xl bg-surface-field p-1">
        {PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => pick(days)}
            className={cn(
              'rounded-lg px-3.5 py-2 text-xs font-bold transition-colors',
              current === days ? 'bg-white text-ink shadow-sm' : 'text-ink-400 hover:text-ink',
            )}
          >
            {LABELS[days]}
          </button>
        ))}
      </div>
    </div>
  );
}
