'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Panel deslizante inferior en móvil, diálogo centrado en escritorio. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const widths = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex h-dvh w-full items-start justify-center overflow-y-auto">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col rounded-t-sheet bg-white shadow-sheet',
          'animate-slide-up sm:rounded-sheet',
          widths[size],
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-surface-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink-700">{title}</h2>
          <button type="button" onClick={onClose} className="icon-btn h-9 w-9" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-surface-line px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmación destructiva reutilizable. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="text-sm leading-relaxed text-ink-400">{message}</p>
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onClose} className="btn-ghost flex-1">
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="btn-danger flex-1 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
