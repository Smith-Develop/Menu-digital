'use client';

import { useEffect, useState } from 'react';
import { minutesSince } from '@/lib/utils';
import { Badge } from '@/components/ui/misc';
import { useT, interpolate } from '@/i18n/provider';

/**
 * Minutos transcurridos desde un instante, calculados sólo en el navegador.
 *
 * El servidor pinta el HTML en un momento y el navegador lo hidrata en otro; si
 * entre ambos cambia el minuto, los dos textos no coinciden y React descarta el
 * árbol entero con un error de hidratación. Se deja el hueco vacío en el primer
 * pintado y se rellena al montar, que además permite irlo actualizando solo
 * mientras la comanda sigue en pantalla.
 */
export function useElapsedMinutes(desde: string): number | null {
  const [minutos, setMinutos] = useState<number | null>(null);

  useEffect(() => {
    const calcular = () => setMinutos(minutesSince(desde));
    calcular();
    const temporizador = setInterval(calcular, 30_000);
    return () => clearInterval(temporizador);
  }, [desde]);

  return minutos;
}

/**
 * Insignia con los minutos que lleva algo esperando. Cambia de color según se
 * alarga: por encima de un cuarto de hora empieza a avisar.
 */
export function Transcurrido({ desde, plano = false }: { desde: string; plano?: boolean }) {
  const t = useT();
  const minutos = useElapsedMinutes(desde);

  if (minutos === null) return null;

  const texto = interpolate(t.kitchen.elapsed, { n: minutos });
  if (plano) return <>{texto}</>;

  return (
    <Badge tone={minutos > 25 ? 'danger' : minutos > 15 ? 'warning' : 'brand'}>{texto}</Badge>
  );
}
