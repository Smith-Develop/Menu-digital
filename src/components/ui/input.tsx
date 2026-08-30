'use client';

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

function FieldShell({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-semibold text-state-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-ink-300">{hint}</span>
      ) : null}
    </label>
  );
}

const FIELD =
  'w-full rounded-xl bg-surface-field px-4 py-3.5 text-[15px] text-ink placeholder:text-ink-400 ' +
  'border border-transparent transition-colors focus:border-brand/40 focus:bg-white ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  icon?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className, ...props },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <span className="relative block">
        {icon && (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(FIELD, icon && 'pl-12', error && 'border-state-danger/50', className)}
          {...props}
        />
      </span>
    </FieldShell>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, rows = 3, ...props },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <textarea ref={ref} rows={rows} className={cn(FIELD, 'resize-y', className)} {...props} />
    </FieldShell>
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, children, ...props },
  ref,
) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <select ref={ref} className={cn(FIELD, 'appearance-none pr-10 bg-no-repeat', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23676767' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.85rem center',
        }}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

/** Interruptor de encendido/apagado con estilo de la app. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-center gap-3', disabled && 'opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 overflow-hidden rounded-full p-0 transition-colors',
          checked ? 'bg-brand' : 'bg-surface-line',
        )}
      >
        {/*
          `left` explícito: sin él la posición estática de un absoluto dentro de
          un <button> depende de cómo el navegador alinee su contenido, y la
          bolita acababa saliéndose y tapando la etiqueta de al lado.
        */}
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      {label && <span className="text-sm text-ink-600">{label}</span>}
    </label>
  );
}
