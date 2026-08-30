'use client';

import { useState, type ReactNode } from 'react';
import { Check, Languages } from 'lucide-react';
import { LOCALES, LOCALE_LABELS } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export function LocaleSwitcher({ trigger }: { trigger?: ReactNode }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t.common.language}>
        {trigger ?? (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-400">
            <Languages className="h-4 w-4" />
            {LOCALE_LABELS[locale]}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t.common.language}>
        <ul className="space-y-2">
          {LOCALES.map((code) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => setLocale(code)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left text-sm font-semibold transition-colors',
                  code === locale ? 'bg-brand-50 text-brand-700' : 'bg-surface-field text-ink hover:bg-surface-muted',
                )}
              >
                {LOCALE_LABELS[code]}
                {code === locale && <Check className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
