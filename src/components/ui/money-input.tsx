'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Campo de importe que acepta la coma decimal.
 *
 * No usa `type="number"` a propósito. Ese tipo sólo admite el separador de la
 * configuración regional del navegador, que rara vez coincide con la del
 * restaurante: quien escribe "2,50" en un teclado español se encuentra el campo
 * vacío y no entiende por qué. Como esta aplicación usa coma decimal sea cual
 * sea la divisa, el campo tiene que hablar ese idioma.
 *
 * Con `inputMode="decimal"` el móvil sigue enseñando el teclado numérico, que
 * es lo único que se perdía al dejar `type="number"`.
 *
 * El texto que se está escribiendo vive aparte del importe: hace falta para que
 * "2," sea un estado válido mientras se teclea, en vez de saltar a "2" y dejar
 * el cursor detrás de un número que el usuario no ha terminado de escribir.
 */
export function MoneyInput({
  id,
  value,
  decimals,
  max,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  /** Importe en la unidad mínima de la divisa. */
  value: number;
  decimals: number;
  max?: number;
  onChange: (cents: number) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const factor = 10 ** decimals;
  const formatear = (cents: number) =>
    cents === 0 ? '' : (cents / factor).toFixed(decimals).replace('.', ',');

  const [texto, setTexto] = useState(() => formatear(value));
  // Lo último que este campo emitió. Sirve para distinguir un cambio que viene
  // de fuera —los botones de porcentaje o de reparto— de la reentrada del
  // valor que acabamos de mandar nosotros, que no debe reescribir el texto.
  const emitido = useRef(value);

  useEffect(() => {
    if (value !== emitido.current) {
      emitido.current = value;
      setTexto(formatear(value));
    }
    // `formatear` depende sólo de `decimals`, que no cambia en vida del campo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      value={texto}
      onChange={(e) => {
        // Se aceptan las dos comas y un solo separador; lo demás se descarta
        // según se teclea, que es menos molesto que rechazar al validar.
        const limpio = e.target.value
          .replace(/[^\d.,]/g, '')
          .replace(/[.,]/g, (m, i, s: string) => (s.indexOf(',') === i || s.indexOf('.') === i ? m : ''));
        setTexto(limpio);

        const numero = Number(limpio.replace(',', '.'));
        let cents = Number.isFinite(numero) ? Math.round(numero * factor) : 0;
        cents = Math.max(cents, 0);
        if (max !== undefined) cents = Math.min(cents, max);

        emitido.current = cents;
        onChange(cents);
      }}
      onBlur={() => setTexto(formatear(value))}
      className={cn('input w-full text-right font-display tabular-nums', className)}
    />
  );
}
