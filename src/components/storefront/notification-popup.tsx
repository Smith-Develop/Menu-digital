'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { useLockScroll } from '@/lib/lock-scroll';

export type PopupNotification = {
  id: string;
  title: string;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
};

const SEEN_KEY = 'yumi_seen_notifications';

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Aviso emergente que publica el superadministrador.
 *
 * Los ya vistos se recuerdan en localStorage: son mensajes de campaña, no
 * información crítica, así que no merecen una tabla ni una cuenta de usuario.
 */
export function NotificationPopup({ notifications }: { notifications: PopupNotification[] }) {
  const t = useT();
  const [current, setCurrent] = useState<PopupNotification | null>(null);
  // Igual que en los avisos del panel: bloquear siempre dejaba la tienda sin
  // desplazamiento aunque no hubiera ningún aviso que enseñar.
  useLockScroll(current !== null);

  useEffect(() => {
    if (notifications.length === 0) return;
    const seen = readSeen();
    const pending = notifications.find((n) => !seen.includes(n.id));
    if (!pending) return;

    // Pequeño retardo: irrumpir en el primer pintado resulta agresivo.
    const timer = setTimeout(() => setCurrent(pending), 1200);
    return () => clearTimeout(timer);
  }, [notifications]);

  function dismiss() {
    if (!current) return;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...readSeen(), current.id].slice(-50)));
    } catch {
      /* modo privado o almacenamiento bloqueado: se volverá a mostrar */
    }
    setCurrent(null);
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[90] flex h-dvh w-full items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        aria-label={t.common.close}
        onClick={dismiss}
        className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="yumi-popup-title"
        className="relative w-full max-w-md overflow-hidden rounded-sheet bg-white shadow-card animate-slide-up sm:animate-fade-up"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label={t.common.close}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-chip backdrop-blur"
        >
          <X className="h-4 w-4" />
        </button>

        {current.image_url && (
          <div className="relative aspect-[16/9] w-full bg-surface-muted">
            <Image
              src={current.image_url}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 384px"
              className="object-cover"
            />
          </div>
        )}

        <div className="p-5">
          <h2 id="yumi-popup-title" className="font-display text-lg font-bold text-ink">
            {current.title}
          </h2>
          {current.body && (
            <p className="mt-2 text-sm leading-relaxed text-ink-400">{current.body}</p>
          )}

          <div className="mt-5 flex gap-3">
            {current.link_url ? (
              <>
                <button type="button" onClick={dismiss} className="btn-ghost flex-1">
                  {t.common.close}
                </button>
                <Link href={current.link_url} onClick={dismiss} className="btn-primary flex-1">
                  {current.link_label || t.common.seeAll}
                </Link>
              </>
            ) : (
              <button type="button" onClick={dismiss} className="btn-primary w-full">
                {t.common.close}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
