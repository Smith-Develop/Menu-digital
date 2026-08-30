'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale } from './config';
import es from './dictionaries/es';
import en from './dictionaries/en';
import type { Dictionary } from './dictionaries/es';

const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

type I18nValue = {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE],
      setLocale: (next) => {
        // Cookie de un año; recargamos para que el servidor repinte con el idioma nuevo.
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        window.location.reload();
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n debe usarse dentro de <I18nProvider>');
  return ctx;
}

/** Atajo para los componentes que sólo necesitan traducir. */
export function useT(): Dictionary {
  return useI18n().t;
}

/** Sustituye marcadores {n}, {amount}… en una cadena del diccionario. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in values ? String(values[key]) : `{${key}}`,
  );
}
