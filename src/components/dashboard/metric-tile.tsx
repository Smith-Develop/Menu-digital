'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Cuenta desde cero hasta el valor final.
 *
 * Usa requestAnimationFrame en vez de un intervalo para que la animación siga
 * el refresco real de la pantalla, y respeta a quien ha pedido menos
 * movimiento en su sistema: en ese caso el número aparece ya puesto.
 */
function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || duration <= 0) {
      setValue(target);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // Suavizado de salida: rápido al principio, calmado al final.
      const eased = 1 - (1 - progress) ** 3;
      setValue(target * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);

  return value;
}

const TONES = {
  brand: 'from-brand/90 to-brand-700 text-brand-contrast',
  ink: 'from-ink to-ink-700 text-white',
  success: 'from-emerald-500 to-emerald-700 text-white',
  accent: 'from-accent to-accent-dark text-accent-contrast',
} as const;

/**
 * Tarjeta de métrica con relieve.
 *
 * El degradado y la doble sombra dan sensación de volumen sin recurrir a
 * transformaciones 3D reales, que en un panel lleno de tarjetas marean más de
 * lo que aportan.
 */
export function MetricTile({
  label,
  value,
  format,
  hint,
  icon,
  tone = 'brand',
  delay = 0,
}: {
  label: string;
  value: number;
  format?: (value: number) => string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: keyof typeof TONES;
  delay?: number;
}) {
  const animated = useCountUp(value);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 animate-fade-up',
        'shadow-[0_16px_32px_-16px_rgba(26,24,23,0.45),inset_0_1px_0_rgba(255,255,255,0.25)]',
        TONES[tone],
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Brillo superior: es lo que da la sensación de relieve. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15 blur-2xl"
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] opacity-75">{label}</p>
        {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      </div>

      <p className="relative mt-3 font-display text-[26px] font-bold leading-none tabular-nums">
        {format ? format(animated) : Math.round(animated).toLocaleString('es-ES')}
      </p>

      {hint && <p className="relative mt-1.5 text-xs opacity-70">{hint}</p>}
    </div>
  );
}

/** Barra que crece al aparecer, para comparar filas de un ranking. */
export function GrowBar({ ratio, tone = 'brand' }: { ratio: number; tone?: 'brand' | 'muted' }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(Math.max(ratio * 100, 3)));
    return () => cancelAnimationFrame(id);
  }, [ratio]);

  return (
    <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-line">
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-700 ease-out',
          tone === 'brand' ? 'bg-brand' : 'bg-ink-200',
        )}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
