'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'outline' | 'accent' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'block';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-[0_8px_20px_-8px_rgba(255,118,34,0.9)] hover:bg-brand-700',
  accent: 'bg-accent text-ink hover:bg-accent-dark',
  ghost: 'border border-surface-line bg-white text-ink hover:bg-surface-soft',
  outline: 'border border-brand bg-white text-brand hover:bg-brand-50',
  danger: 'bg-state-danger text-white hover:brightness-95',
  subtle: 'bg-surface-field text-ink hover:bg-surface-muted',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3.5 py-2 text-xs rounded-lg',
  md: 'px-5 py-3 text-sm rounded-xl',
  lg: 'px-6 py-4 text-[15px] rounded-2xl',
  block: 'w-full px-6 py-4 text-[15px] rounded-2xl',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-bold tracking-wide transition-all active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});
