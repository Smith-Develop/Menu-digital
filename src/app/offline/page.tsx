import { WifiOff } from 'lucide-react';
import { getI18n } from '@/i18n';
import { getBrand } from '@/lib/brand';

export const metadata = { title: 'Sin conexión' };

/** Página que sirve el service worker cuando no hay red. */
export default async function OfflinePage() {
  const [{ t }, brand] = await Promise.all([getI18n(), getBrand()]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-soft px-8 text-center">
      <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-ink-300">
        <WifiOff className="h-7 w-7" />
      </span>
      <h1 className="font-display text-xl font-bold text-ink">{t.pwa.offlineTitle}</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-300">{t.pwa.offlineHint}</p>
      {/* Un <a> y no <Link>: aquí no hay red, así que hace falta una recarga
          completa del documento en lugar de una navegación del router. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="btn-primary mt-7">
        {t.common.retry}
      </a>
      <p className="mt-8 text-xs text-ink-200">{brand.appName}</p>
    </div>
  );
}
