'use client';

import { Plus, X } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * Horario semanal del local.
 *
 * Se guarda con los días en ISO —1 es lunes— y tantos tramos como haga falta:
 * `{"1": [["09:00","16:00"], ["20:00","23:30"]]}`. Un día sin tramos está
 * cerrado; el objeto vacío significa "sin horario definido" y entonces manda el
 * interruptor de abrir y cerrar, que es como funcionaban los locales que ya
 * existían.
 *
 * Los tramos que cruzan la medianoche se escriben tal cual —de 20:00 a 02:00—
 * y la base los entiende: es lo normal en hostelería y obligar a partirlos en
 * dos días sería pedirle al usuario que piense como la base de datos.
 */
export type OpeningHours = Record<string, [string, string][]>;

const DIAS = ['1', '2', '3', '4', '5', '6', '7'] as const;

export function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningHours;
  onChange: (v: OpeningHours) => void;
}) {
  const { t } = useI18n();

  const NOMBRE: Record<string, string> = {
    '1': t.hours.mon,
    '2': t.hours.tue,
    '3': t.hours.wed,
    '4': t.hours.thu,
    '5': t.hours.fri,
    '6': t.hours.sat,
    '7': t.hours.sun,
  };

  function tramos(dia: string): [string, string][] {
    return value[dia] ?? [];
  }

  function set(dia: string, lista: [string, string][]) {
    const siguiente = { ...value };
    if (lista.length === 0) delete siguiente[dia];
    else siguiente[dia] = lista;
    onChange(siguiente);
  }

  const definido = Object.keys(value).length > 0;

  return (
    <div>
      <p className="label">{t.hours.title}</p>
      <p className="mb-3 -mt-1 text-xs text-ink-300">
        {definido ? t.hours.hint : t.hours.hintEmpty}
      </p>

      <ul className="space-y-2">
        {DIAS.map((dia) => {
          const lista = tramos(dia);
          const abierto = lista.length > 0;
          return (
            <li
              key={dia}
              className={cn(
                'rounded-xl px-4 py-3 transition-colors',
                abierto ? 'bg-surface-field' : 'bg-surface-soft',
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'w-24 shrink-0 text-sm font-semibold',
                    abierto ? 'text-ink-700' : 'text-ink-300',
                  )}
                >
                  {NOMBRE[dia]}
                </span>

                {!abierto && (
                  <span className="flex-1 text-sm text-ink-300">{t.hours.closed}</span>
                )}

                <button
                  type="button"
                  onClick={() =>
                    abierto ? set(dia, []) : set(dia, [['09:00', '23:00']])
                  }
                  className="btn-soft ml-auto shrink-0 px-3 py-1.5 text-xs"
                >
                  {abierto ? t.hours.close : t.hours.open}
                </button>
              </div>

              {abierto && (
                <div className="mt-3 space-y-2">
                  {lista.map((tramo, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={tramo[0]}
                        aria-label={`${NOMBRE[dia]} · ${t.hours.from}`}
                        onChange={(e) => {
                          const copia = [...lista];
                          copia[i] = [e.target.value, tramo[1]];
                          set(dia, copia);
                        }}
                        className="field w-32 py-2 text-sm"
                      />
                      <span className="text-xs text-ink-300">{t.hours.to}</span>
                      <input
                        type="time"
                        value={tramo[1]}
                        aria-label={`${NOMBRE[dia]} · ${t.hours.to}`}
                        onChange={(e) => {
                          const copia = [...lista];
                          copia[i] = [tramo[0], e.target.value];
                          set(dia, copia);
                        }}
                        className="field w-32 py-2 text-sm"
                      />
                      {lista.length > 1 && (
                        <button
                          type="button"
                          onClick={() => set(dia, lista.filter((_, j) => j !== i))}
                          aria-label={t.common.remove}
                          className="icon-btn h-9 w-9 shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Dos tramos cubren el caso normal: comidas y cenas. */}
                  {lista.length < 3 && (
                    <button
                      type="button"
                      onClick={() => set(dia, [...lista, ['20:00', '23:30']])}
                      className="btn-soft px-3 py-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.hours.addSlot}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {definido && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="btn-soft mt-3 px-3 py-1.5 text-xs"
        >
          {t.hours.clear}
        </button>
      )}
    </div>
  );
}
