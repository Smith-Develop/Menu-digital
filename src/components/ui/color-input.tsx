'use client';

import { cn } from '@/lib/utils';

/**
 * Selector de color con la muestra y el hexadecimal juntos.
 * El campo de texto acepta pegar un valor, que es como llega casi siempre
 * un color corporativo.
 */
export function ColorInput({
  label,
  value,
  onChange,
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  className?: string;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className={className}>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <label
          className="relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-surface-line"
          style={{ backgroundColor: valid ? value : '#ffffff' }}
        >
          <input
            type="color"
            value={valid ? value : '#000000'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={label}
          />
        </label>
        <input
          value={value}
          onChange={(e) => {
            const next = e.target.value.trim();
            onChange(next.startsWith('#') ? next.toUpperCase() : `#${next.toUpperCase()}`);
          }}
          maxLength={7}
          spellCheck={false}
          className={cn('field font-mono uppercase', !valid && 'border-state-danger/50')}
        />
      </div>
      {hint && <span className="mt-1.5 block text-xs text-ink-300">{hint}</span>}
    </div>
  );
}
