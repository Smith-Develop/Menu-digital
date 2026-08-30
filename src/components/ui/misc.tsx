'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Cabecera de pantalla móvil: flecha circular a la izquierda, título centrado
 * y acción opcional a la derecha. Replica el patrón de todas las pantallas del Figma.
 */
export function ScreenHeader({
  title,
  backHref,
  action,
  className,
}: {
  title: ReactNode;
  backHref?: string;
  action?: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  return (
    <header className={cn('flex items-center gap-4 px-5 pb-2 pt-4', className)}>
      {backHref ? (
        <Link href={backHref} className="icon-btn shrink-0" aria-label="Volver">
          <ChevronLeft className="h-5 w-5" />
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => router.back()}
          className="icon-btn shrink-0"
          aria-label="Volver"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="flex-1 truncate font-display text-lg font-bold text-ink-700">{title}</h1>
      {action}
    </header>
  );
}

export function SectionHeader({
  title,
  href,
  actionLabel,
  className,
}: {
  title: ReactNode;
  href?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-4', className)}>
      <h2 className="section-title capitalize">{title}</h2>
      {href && actionLabel && (
        <Link href={href} className="shrink-0 text-sm text-ink-400 transition-colors hover:text-brand">
          {actionLabel} ›
        </Link>
      )}
    </div>
  );
}

export function Rating({ value, count, className }: { value: number; count?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Star className="h-3.5 w-3.5 fill-accent-dark text-accent-dark" />
      <span className="text-sm font-semibold text-ink-200">{value.toFixed(1)}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-xs text-ink-300">({count})</span>
      )}
    </span>
  );
}

const BADGE_TONES = {
  neutral: 'bg-surface-muted text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  accent: 'bg-accent/25 text-ink-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  /** Para badges colocados sobre una superficie oscura (ink). */
  onDark: 'bg-white/15 text-white',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-ink-300">
          {icon}
        </div>
      )}
      <p className="font-display text-base font-bold text-ink-700">{title}</p>
      {description && <p className="mt-1.5 max-w-xs text-sm text-ink-300">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Selector de cantidad − 2 + de la ficha de plato. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  tone = 'dark',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  tone?: 'dark' | 'light';
}) {
  const wrapper =
    tone === 'dark'
      ? 'bg-ink text-white'
      : 'bg-surface-field text-ink';
  const button =
    tone === 'dark'
      ? 'bg-white/15 hover:bg-white/25 disabled:opacity-30'
      : 'bg-white hover:bg-surface-muted disabled:opacity-40';

  return (
    <div className={cn('inline-flex items-center gap-3 rounded-full p-1.5', wrapper)}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className={cn('flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold transition-colors', button)}
        aria-label="Restar uno"
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className={cn('flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold transition-colors', button)}
        aria-label="Sumar uno"
      >
        +
      </button>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-surface-line border-t-brand',
        className,
      )}
      role="status"
      aria-label="Cargando"
    />
  );
}

/** Placeholder de carga con la forma del contenido final. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-muted', className)} />;
}
