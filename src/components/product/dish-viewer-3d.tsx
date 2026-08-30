'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Loader2, Maximize2, RotateCcw, Smartphone } from 'lucide-react';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * Visor 3D + realidad aumentada de un plato.
 *
 * Usa <model-viewer> de Google porque resuelve de una vez las tres cosas que
 * necesitamos: órbita con el dedo, AR nativa en Android (Scene Viewer) y AR en
 * iOS (Quick Look, que exige un .usdz aparte). El módulo se importa sólo en el
 * navegador: es un web component y rompería el render de servidor.
 */
export function DishViewer3D({
  modelUrl,
  iosModelUrl,
  poster,
  alt,
  scale = 1,
  className,
  compact = false,
}: {
  modelUrl: string | null;
  iosModelUrl?: string | null;
  poster?: string | null;
  alt: string;
  scale?: number;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const viewerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@google/model-viewer')
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!modelUrl) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface-muted px-6 py-10 text-center',
          className,
        )}
      >
        <Box className="h-8 w-8 text-ink-200" />
        <p className="text-sm text-ink-300">{t.product.no3dModel}</p>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-surface-muted', className)}>
      {!ready && !failed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-muted">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      )}

      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Box className="h-8 w-8 text-ink-200" />
          <p className="text-sm text-ink-300">{t.common.error}</p>
        </div>
      ) : (
        <model-viewer
          ref={viewerRef as never}
          src={modelUrl}
          ios-src={iosModelUrl ?? undefined}
          poster={poster ?? undefined}
          alt={alt}
          ar
          ar-modes="webxr scene-viewer quick-look"
          ar-placement="floor"
          ar-scale="fixed"
          camera-controls
          auto-rotate
          auto-rotate-delay={800}
          rotation-per-second="18deg"
          shadow-intensity="1"
          shadow-softness="0.8"
          exposure="1.05"
          touch-action="pan-y"
          loading="lazy"
          scale={`${scale} ${scale} ${scale}`}
          style={{ width: '100%', height: '100%', backgroundColor: 'transparent', '--poster-color': 'transparent' } as React.CSSProperties}
        >
          {/* Botón de AR: model-viewer lo activa cuando el dispositivo lo soporta. */}
          <button
            slot="ar-button"
            type="button"
            className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-xs font-bold text-white shadow-card"
          >
            <Smartphone className="h-4 w-4" />
            {t.product.viewAr}
          </button>
          <div slot="progress-bar" />
        </model-viewer>
      )}

      {!compact && ready && !failed && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-600 backdrop-blur">
          <RotateCcw className="h-3 w-3" />
          3D
        </div>
      )}
    </div>
  );
}

/** Botón que abre el visor a pantalla completa desde la ficha del plato. */
export function View3DButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-surface-line bg-white/90 px-4 py-2.5',
        'text-xs font-bold text-ink-700 shadow-chip backdrop-blur transition-colors',
        'hover:border-brand hover:text-brand disabled:opacity-40',
      )}
    >
      <Maximize2 className="h-4 w-4" />
      {t.product.view3d}
    </button>
  );
}
