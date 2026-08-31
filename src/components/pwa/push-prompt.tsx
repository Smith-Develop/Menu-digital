'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { useToast } from '@/components/ui/toast';
import { subscribeToPush } from '@/lib/push-client';
import { cn } from '@/lib/utils';

const MOTIVOS = (t: ReturnType<typeof useT>): Record<string, string> => ({
  'sitio-inseguro': t.permissions.insecure,
  'sin-configurar': t.permissions.notConfigured,
  'sin-soporte': t.permissions.unsupported,
  fallo: t.common.error,
});

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
  const toast = useToast();
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
    setState('working');

    // Todo el trabajo —permiso, service worker y alta en el servidor— vive en
    // un solo sitio, que es el que también usan la bienvenida y el panel.
    const resultado = await subscribeToPush({ orderId, citySlug });

    if (resultado === 'ok') {
      setState('granted');
      return;
    }
    if (resultado === 'denegado') {
      setState('denied');
      return;
    }

    setState('idle');
    toast(MOTIVOS(t)[resultado] ?? t.common.error, 'info');
  }

  if (state === 'unsupported') return null;

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
