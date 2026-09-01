'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { importProducts, type ImportReport } from '@/app/dashboard/actions';
import { rowsFromDelimited, type ProductRow } from '@/lib/csv';
import { useI18n, interpolate } from '@/i18n/provider';

/** Los títulos de columna con los que sale una plantilla vacía. */
const PLANTILLA =
  'nombre;marca;formato;precio;unidad;contenido;codigo de barras;categoria;iva;stock;disponible\n' +
  'Leche entera;Central Lechera;1 L;1,15;l;1;8412345678905;Lácteos;4;24;si\n';

/**
 * Subir el catálogo entero desde un fichero.
 *
 * La importación va en dos tiempos a propósito. Primero se lee el fichero en el
 * navegador y se pide a la base el mismo informe que dará al escribir, pero sin
 * escribir: cuántas se crean, cuántas se actualizan, qué filas no se entienden
 * y qué pasillos no existen. Sólo después se confirma.
 *
 * El motivo es que aquí un error no se deshace con un botón: quien sube cuatro
 * mil referencias mal no tiene forma humana de repararlas a mano.
 */
export function CatalogImport() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);

  const [filas, setFilas] = useState<ProductRow[]>([]);
  const [columnas, setColumnas] = useState<{ ok: string[]; todas: string[] }>({
    ok: [],
    todas: [],
  });
  const [informe, setInforme] = useState<ImportReport | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function leer(fichero: File) {
    setOcupado(true);
    const { rows, recognised, headers } = rowsFromDelimited(await fichero.text());
    setColumnas({ ok: recognised, todas: headers });
    setFilas(rows);

    if (!recognised.includes('name') || !recognised.includes('price')) {
      setOcupado(false);
      setInforme(null);
      setAbierto(true);
      return;
    }

    // El ensayo en seco: el mismo informe, sin tocar nada.
    const result = await importProducts(rows, true);
    setOcupado(false);

    if (!result.ok) {
      toast(mensaje(result.error), 'error');
      return;
    }
    setInforme(result.data);
    setAbierto(true);
  }

  function mensaje(code: string): string {
    const textos = t.import as unknown as Record<string, string>;
    return textos[code] ?? t.common.error;
  }

  async function confirmar() {
    setOcupado(true);
    const result = await importProducts(filas, false);
    setOcupado(false);

    if (!result.ok) {
      toast(mensaje(result.error), 'error');
      return;
    }
    setAbierto(false);
    setFilas([]);
    toast(`${t.import.done}: ${result.data.created + result.data.updated}`, 'success');
    router.refresh();
  }

  // Sin nombre y sin precio no hay nada que importar: es la única condición
  // que impide seguir, y por eso se comprueba aquí y no en la base.
  const utilizable = columnas.ok.includes('name') && columnas.ok.includes('price');

  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // El valor se limpia para que subir dos veces el mismo fichero
          // vuelva a disparar el evento.
          e.target.value = '';
          if (f) leer(f);
        }}
      />

      <Button variant="ghost" loading={ocupado && !abierto} onClick={() => entrada.current?.click()}>
        <Upload className="h-4 w-4" />
        {t.import.title}
      </Button>

      <Sheet
        open={abierto}
        onClose={() => setAbierto(false)}
        title={t.import.title}
        size="lg"
        footer={
          informe && utilizable ? (
            <Button size="block" loading={ocupado} onClick={confirmar}>
              <Check className="h-4 w-4" />
              {t.import.confirm}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          <p className="text-sm text-ink-300">
            {interpolate(t.import.rowsRead, { n: filas.length })}
          </p>

          {!utilizable ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                {t.import.needName}
              </p>
              <p className="mt-2 text-xs text-amber-800">
                {t.import.unknownColumns}: {columnas.todas.join(', ') || '—'}
              </p>
            </div>
          ) : (
            informe && (
              <>
                <p className="label">{t.import.preview}</p>
                <div className="grid grid-cols-3 gap-3">
                  <Cifra label={t.import.willCreate} valor={informe.created} tono="bien" />
                  <Cifra label={t.import.willUpdate} valor={informe.updated} />
                  <Cifra label={t.import.willFail} valor={informe.failed} tono="mal" />
                </div>

                {informe.unknown_categories.length > 0 && (
                  <div className="rounded-xl bg-amber-50 px-4 py-3">
                    <p className="text-xs text-amber-800">{t.import.unknownCategories}</p>
                    <p className="mt-2 text-sm font-semibold text-amber-900">
                      {informe.unknown_categories.join(', ')}
                    </p>
                  </div>
                )}

                {informe.errors.length > 0 && (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-surface-field p-3">
                    {informe.errors.slice(0, 60).map((e) => (
                      <li key={e.row} className="text-xs text-ink-400">
                        <span className="font-semibold text-ink-600">
                          {interpolate(t.import.errorRow, { n: e.row })}
                        </span>{' '}
                        · {mensaje(e.code)}
                        {e.name ? ` · ${e.name}` : ''}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-xs text-ink-300">{t.import.matchHint}</p>
              </>
            )
          )}

          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(PLANTILLA)}`}
            download="catalogo.csv"
            className="inline-flex items-center gap-2 text-xs font-bold text-brand"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {t.import.template}
          </a>
        </div>
      </Sheet>
    </>
  );
}

function Cifra({
  label,
  valor,
  tono,
}: {
  label: string;
  valor: number;
  tono?: 'bien' | 'mal';
}) {
  return (
    <div className="rounded-xl bg-surface-field px-3 py-3 text-center">
      <p
        className={
          'font-display text-2xl font-bold tabular-nums ' +
          (tono === 'bien' ? 'text-state-success' : tono === 'mal' && valor > 0 ? 'text-state-danger' : 'text-ink')
        }
      >
        {valor}
      </p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-300">
        {label}
      </p>
    </div>
  );
}
