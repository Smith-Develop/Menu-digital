'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Check, ConciergeBell, Droplets, HelpCircle, Receipt } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { attendCall } from '@/app/dashboard/actions';
import { playSound, unlockAudio, type SoundSettings } from '@/lib/sounds';
import { useT } from '@/i18n/provider';
import type { Enums } from '@/types/database';

type Aviso = {
  id: string;
  type: Enums<'call_type'>;
  tableName: string | null;
  tableId: string;
  createdAt: string;
};

const ICONO: Record<string, typeof ConciergeBell> = {
  waiter: ConciergeBell,
  bill: Receipt,
  water: Droplets,
  help: HelpCircle,
};

/**
 * Avisos de las mesas, en cualquier pantalla del panel.
 *
 * Vive en el marco del panel y no en una página concreta porque el aviso hay
 * que verlo se esté donde se esté: antes sólo sonaba en la comanda y en los
 * pedidos en directo, y quien estuviera editando la carta no se enteraba.
 *
 * Se muestra a pantalla completa a propósito. Un aviso pequeño en una esquina
 * es justo lo que se pasa por alto cuando hay trabajo, que es cuando más falta
 * hace atenderlo.
 *
 * Un camarero sólo recibe los de sus mesas; el resto del equipo, todos.
 */
export function StaffAlerts({
  restaurantId,
  sounds,
  onlyMyTables,
  userId,
}: {
  restaurantId: string;
  sounds: SoundSettings;
  onlyMyTables: boolean;
  userId: string;
}) {
  const t = useT();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [cerrando, setCerrando] = useState<string | null>(null);
  const vistos = useRef<Set<string>>(new Set());
  const primeraLectura = useRef(true);

  useEffect(() => {
    const habilitar = () => unlockAudio();
    window.addEventListener('pointerdown', habilitar, { once: true });
    return () => window.removeEventListener('pointerdown', habilitar);
  }, []);

  const releer = useCallback(async () => {
    const supabase = createClient();

    const { data } = await supabase
      .from('waiter_calls')
      .select('id, type, table_id, created_at, tables(name, assigned_waiter_id)')
      .eq('restaurant_id', restaurantId)
      .is('attended_at', null)
      .order('created_at', { ascending: false });

    if (!data) return;

    const filas: Aviso[] = data
      .filter((fila) => {
        if (!onlyMyTables) return true;
        const mesa = (fila as { tables?: { assigned_waiter_id?: string | null } }).tables;
        return mesa?.assigned_waiter_id === userId;
      })
      .map((fila) => ({
        id: fila.id,
        type: fila.type,
        tableId: fila.table_id,
        tableName: (fila as { tables?: { name?: string } }).tables?.name ?? null,
        createdAt: fila.created_at,
      }));

    const nuevos = filas.filter((aviso) => !vistos.current.has(aviso.id));
    vistos.current = new Set(filas.map((aviso) => aviso.id));

    // En la primera lectura no suena: lo pendiente de antes no es una novedad
    // y arrancar el panel con una alarma sería desconcertante.
    if (nuevos.length > 0 && !primeraLectura.current && sounds.enabled) {
      playSound(sounds.waiterCall, sounds.volume);
    }
    primeraLectura.current = false;

    setAvisos(filas);
  }, [restaurantId, onlyMyTables, userId, sounds]);

  useEffect(() => {
    void releer();
    const temporizador = setInterval(releer, 12_000);
    return () => clearInterval(temporizador);
  }, [releer]);

  async function atender(aviso: Aviso) {
    setCerrando(aviso.id);
    await attendCall(aviso.id);
    setCerrando(null);
    setAvisos((actuales) => actuales.filter((a) => a.id !== aviso.id));
  }

  if (avisos.length === 0) return null;

  const actual = avisos[0];
  const Icono = ICONO[actual.type] ?? ConciergeBell;
  const etiqueta: Record<string, string> = {
    waiter: t.table.callWaiter,
    bill: t.table.callBill,
    water: t.table.callWater,
    help: t.table.callHelp,
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/70 px-6 backdrop-blur">
      <div className="w-full max-w-sm rounded-sheet bg-white p-8 text-center shadow-card animate-scale-in">
        <span className="mx-auto flex h-24 w-24 animate-pulse items-center justify-center rounded-full bg-brand text-brand-contrast">
          <Icono className="h-11 w-11" />
        </span>

        <p className="mt-6 font-display text-4xl font-bold text-ink">
          {actual.tableName ?? t.table.calls}
        </p>
        <p className="mt-2 text-base text-ink-400">{etiqueta[actual.type] ?? t.table.calls}</p>

        {avisos.length > 1 && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface-field px-4 py-1.5 text-sm text-ink-400">
            <BellRing className="h-4 w-4" />
            {t.floor.morePending.replace('{count}', String(avisos.length - 1))}
          </p>
        )}

        <button
          type="button"
          onClick={() => atender(actual)}
          disabled={cerrando === actual.id}
          className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-full bg-ink px-9 py-4 font-display text-lg font-bold text-white transition-transform active:scale-95 disabled:opacity-60"
        >
          <Check className="h-5 w-5" strokeWidth={3} />
          {t.floor.attend}
        </button>
      </div>
    </div>
  );
}
