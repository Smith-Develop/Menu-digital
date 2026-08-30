'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker que hace instalable la aplicación.
 *
 * Se hace desde un componente cliente y tras la carga para no competir con el
 * primer pintado. En desarrollo se desregistra: un service worker cacheando
 * durante `next dev` sirve páginas viejas y confunde.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => void registration.unregister());
      });
      return;
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Sin service worker la aplicación sigue funcionando; solo pierde la
        // instalación y el modo sin conexión.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
