'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { useT } from '@/i18n/provider';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'yumi_install_dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Invitación a instalar la aplicación.
 *
 * Chrome y Edge avisan con `beforeinstallprompt` y permiten lanzar el diálogo
 * nativo. Safari en iOS no lo implementa, así que allí explicamos el gesto
 * manual (Compartir → Añadir a pantalla de inicio).
 */
export function InstallPrompt({ appName }: { appName: string }) {
  const t = useT();
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || isStandalone()) return;

    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      /* almacenamiento bloqueado: mostramos igualmente */
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS no dispara el evento: detectamos Safari móvil para dar la instrucción.
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (isIos && isSafari) {
      const timer = setTimeout(() => setShowIosHint(true), 4000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', onPrompt);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* sin persistencia volverá a aparecer, no es grave */
    }
    setDeferred(null);
    setShowIosHint(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') dismiss();
    setDeferred(null);
  }

  if (!deferred && !showIosHint) return null;

  if (showSteps) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[80] px-4 pb-[calc(1rem+var(--safe-bottom))] lg:left-auto lg:right-6 lg:w-96">
        <div className="rounded-2xl bg-ink px-5 py-4 text-white shadow-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold">{t.pwa.howTo}</p>
            <button
              type="button"
              onClick={() => setShowSteps(false)}
              aria-label={t.common.close}
              className="text-white/50 transition-colors hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ol className="space-y-2.5 text-xs text-white/75">
            {[t.pwa.step1, t.pwa.step2, t.pwa.step3].map((paso, i) => (
              <li key={paso} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-contrast">
                  {i + 1}
                </span>
                {paso}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[80] px-4 pb-[calc(1rem+var(--safe-bottom))] lg:left-auto lg:right-6 lg:w-96">
      <div className="flex items-center gap-3 rounded-2xl bg-ink px-4 py-3.5 text-white shadow-card">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-contrast">
          {showIosHint ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{t.pwa.installTitle.replace('{app}', appName)}</p>
          <p className="mt-0.5 text-xs text-white/65">
            {showIosHint ? t.pwa.iosHint : t.pwa.installHint}
          </p>
        </div>

        {/* El botón está siempre. En iOS no existe forma de lanzar la
            instalación desde la página, así que allí abre los pasos a seguir:
            dejar sólo la frase suelta hacía que pareciera que faltaba algo. */}
        <button
          type="button"
          onClick={showIosHint ? () => setShowSteps(true) : install}
          className="shrink-0 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-brand-contrast"
        >
          {showIosHint ? t.pwa.howTo : t.pwa.install}
        </button>

        <button
          type="button"
          onClick={dismiss}
          aria-label={t.common.close}
          className="shrink-0 text-white/50 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
