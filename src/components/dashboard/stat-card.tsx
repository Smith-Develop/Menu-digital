import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'bg-surface-field text-ink-500',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
} as const;

export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-chip">
      <div className="flex items-center gap-3">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', TONES[tone])}>
          {icon}
        </span>
        <p className="text-xs font-bold uppercase tracking-wide text-ink-300">{label}</p>
      </div>
      <p className="mt-4 font-display text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-300">{hint}</p>}
    </div>
  );
}
