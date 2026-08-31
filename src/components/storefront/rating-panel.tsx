'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Star, UtensilsCrossed } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { listRatingTargets, rate, type RatingTarget } from '@/app/actions/ratings';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * Valoración de un pedido ya entregado.
 *
 * Se puntúa en la misma pantalla donde se siguió el pedido, que es donde vuelve
 * el cliente, y cada cosa por separado: el restaurante, cada plato, quien lo
 * trajo y quien atendió la mesa. Se guarda al tocar la estrella, sin botón de
 * enviar: una valoración a medias no vale de nada y pedir confirmación sólo
 * añade un paso para abandonarla.
 */
export function RatingPanel({ orderId }: { orderId: string }) {
  const t = useT();
  const toast = useToast();

  const [targets, setTargets] = useState<RatingTarget[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void listRatingTargets(orderId)
      .then((filas) => vivo && setTargets(filas))
      .catch(() => vivo && setTargets([]));
    return () => {
      vivo = false;
    };
  }, [orderId]);

  async function puntuar(target: RatingTarget, score: number) {
    const clave = `${target.type}-${target.id}`;
    setSaving(clave);

    // Se pinta al momento: la estrella tiene que responder al dedo.
    setTargets((actuales) =>
      (actuales ?? []).map((fila) =>
        fila.type === target.type && fila.id === target.id ? { ...fila, score } : fila,
      ),
    );

    const result = await rate(orderId, { type: target.type, id: target.id }, score);
    setSaving(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      setTargets((actuales) =>
        (actuales ?? []).map((fila) =>
          fila.type === target.type && fila.id === target.id
            ? { ...fila, score: target.score }
            : fila,
        ),
      );
    }
  }

  if (targets === null || targets.length === 0) return null;

  const ETIQUETA: Record<RatingTarget['type'], string> = {
    restaurant: t.rating.restaurant,
    product: t.rating.dish,
    courier: t.rating.courier,
    waiter: t.rating.waiter,
  };

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 shadow-chip">
      <h2 className="font-display text-base font-bold text-ink-700">{t.rating.title}</h2>
      <p className="mt-1 text-xs text-ink-300">{t.rating.hint}</p>

      <ul className="mt-4 space-y-3">
        {targets.map((target) => {
          const clave = `${target.type}-${target.id}`;
          return (
            <li key={clave} className="flex items-center gap-3">
              <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-surface-field">
                {target.image ? (
                  <Image src={target.image} alt="" fill sizes="44px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-300">
                    <UtensilsCrossed className="h-4 w-4" />
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink-700">{target.name}</span>
                <span className="block text-[11px] uppercase tracking-wide text-ink-300">
                  {ETIQUETA[target.type]}
                </span>
              </span>

              <span className="flex shrink-0 gap-0.5">
                {[1, 2, 3, 4, 5].map((valor) => (
                  <button
                    key={valor}
                    type="button"
                    disabled={saving === clave}
                    onClick={() => puntuar(target, valor)}
                    aria-label={`${valor}`}
                    className="p-0.5 transition-transform active:scale-90 disabled:opacity-50"
                  >
                    <Star
                      className={cn(
                        'h-5 w-5',
                        (target.score ?? 0) >= valor
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-ink-200',
                      )}
                    />
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
