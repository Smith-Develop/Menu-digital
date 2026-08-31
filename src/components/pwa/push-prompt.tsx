'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { subscribeToPush } from '@/lib/push-client';
import { cn } from '@/lib/utils';

/** Base64 de la clave VAPID al formato que espera el navegador. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

/**
 * Devuelve el service worker listo para suscribir, registrándolo si hiciera
 * falta. `navigator.serviceWorker.ready` nunca resuelve cuando no hay ninguno
 * registrado —no rechaza, se queda esperando—, así que esperar por él a secas
 * dejaría el botón pensando indefinidamente.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (!existing) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
}

type State = 'unsupported' | 'idle' | 'granted' | 'denied' | 'working';

/**
 * Botón para activar los avisos en el móvil.
 *
 * Nunca pide el permiso solo: los navegadores penalizan (y a veces bloquean sin
 * preguntar) a las páginas que lo reclaman nada más cargar, así que el permiso
 * se pide únicamente cuando la persona pulsa.
 */
export function PushPrompt({
  orderId,
  citySlug,
  className,
}: {
  orderId?: string;
  citySlug?: string | null;
  className?: string;
}) {
  const t = useT();
  const [state, setState] = useState<State>('idle');

  const link = (_subscription: PushSubscription, order: string) =>
    subscribeToPush({ orderId: order, citySlug }).catch(() => false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    if (Notification.permission === 'granted') {
      navigator.serviceWorker
        .getRegistration('/')
        .then((registration) => registration?.pushManager.getSubscription() ?? null)
        .then((subscription) => {
          setState(subscription ? 'granted' : 'idle');
          // Quien ya tenía los avisos activados no vuelve a pulsar el botón, así
          // que sus pedidos nuevos nunca quedarían atados a este dispositivo y
          // se quedaría sin enterarse de ellos. Se registra el vínculo aquí, en
          // silencio: el alta es idempotente y no molesta a nadie.
          if (subscription && orderId) void link(subscription, orderId);
        })
        .catch(() => setState('idle'));
    }
  }, [orderId, citySlug]);

  async function enable() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return;

    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'idle');
        return;
      }

      const registration = await activeRegistration();
      if (!registration) {
        setState('idle');
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));

      setState((await subscribeToPush({ orderId, citySlug })) ? 'granted' : 'idle');
    } catch {
      setState('idle');
    }
  }

  if (state === 'unsupported' || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return null;

  if (state === 'granted') {
    return (
      <p className={cn('flex items-center justify-center gap-2 text-xs text-ink-300', className)}>
        <BellRing className="h-3.5 w-3.5" />
        {t.push.enabled}
      </p>
    );
  }

  if (state === 'denied') {
    return (
      <p className={cn('flex items-center justify-center gap-2 text-xs text-ink-300', className)}>
        <BellOff className="h-3.5 w-3.5" />
        {t.push.blocked}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === 'working'}
      className={cn(
        'flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-white py-3',
        'text-sm font-bold text-ink-700 transition-colors hover:bg-surface-field disabled:opacity-50',
        className,
      )}
    >
      <Bell className="h-4 w-4" />
      {t.push.enable}
    </button>
  );
}
