/**
 * Rango de fechas de las métricas, resuelto desde la URL.
 *
 * Vive aparte porque lo usan tanto el resumen del restaurante como cualquier
 * pantalla que enseñe las mismas cifras: si cada una lo calculara por su cuenta,
 * acabarían mostrando periodos distintos para la misma consulta.
 */
export type AnalyticsRange = {
  from: Date;
  to: Date;
  days: number;
  custom: boolean;
};

/** Fecha de calendario en hora local: toISOString() la desplazaría a UTC. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function resolveRange(params: { days?: string; from?: string; to?: string }): AnalyticsRange {
  const parseDate = (value?: string) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const from = parseDate(params.from);
  const to = parseDate(params.to);

  if (from && to && to >= from) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1); // el rango es inclusivo por el lado derecho
    return {
      from,
      to: end,
      days: Math.round((end.getTime() - from.getTime()) / 86_400_000),
      custom: true,
    };
  }

  const days = Math.min(Math.max(Number(params.days) || 30, 1), 365);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  return { from: start, to: end, days, custom: false };
}
