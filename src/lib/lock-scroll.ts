'use client';

import { useEffect } from 'react';

/**
 * Impide desplazar la página mientras hay una capa abierta encima.
 *
 * Sin esto, el dedo arrastra el contenido de detrás en lugar del diálogo, que
 * es especialmente molesto en un móvil: parece que la capa se ha quedado
 * colgada. Se guarda el valor anterior y se restaura al cerrar, porque puede
 * haber más de una capa abierta a la vez.
 */
export function useLockScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = anterior;
    };
  }, [active]);
}
