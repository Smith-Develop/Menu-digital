'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Switch } from '@/components/ui/input';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { saveDeliverySlot, deleteDeliverySlot } from '@/app/dashboard/actions';
import { useI18n } from '@/i18n/provider';

export type Slot = {
  id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  capacity: number;
  is_active: boolean;
};

const VACIA = { weekday: 1, starts_at: '10:00', ends_at: '12:00', capacity: 0, is_active: true };

/**
 * Franjas de entrega de la semana.
 *
 * Se editan por día de la semana y no por fecha porque el reparto se organiza
 * por costumbre: los martes de diez a doce, todos los martes. La fecha concreta
 * la elige el cliente al pedir, y el cupo se cuenta sobre esa fecha.
 */
export function DeliverySlots({ slots }: { slots: Slot[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [editando, setEditando] = useState<Partial<Slot> | null>(null);
  const [borrando, setBorrando] = useState<Slot | null>(null);
  const [guardando, setGuardando] = useState(false);

  const NOMBRE = [t.hours.mon, t.hours.tue, t.hours.wed, t.hours.thu, t.hours.fri, t.hours.sat, t.hours.sun];

  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    const result = await saveDeliverySlot({
      id: editando.id,
      weekday: editando.weekday ?? 1,
      starts_at: editando.starts_at ?? '10:00',
      ends_at: editando.ends_at ?? '12:00',
      capacity: editando.capacity ?? 0,
      is_active: editando.is_active ?? true,
    });
    setGuardando(false);

    if (!result.ok) {
      toast(
        result.error === 'SLOT_INVALID_RANGE'
          ? t.slots.invalidRange
          : result.error === 'SLOT_DUPLICATE'
            ? t.slots.duplicate
            : t.common.error,
        'error',
      );
      return;
    }
    setEditando(null);
    router.refresh();
  }

  async function borrar() {
    if (!borrando) return;
    setGuardando(true);
    const result = await deleteDeliverySlot(borrando.id);
    setGuardando(false);
    setBorrando(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  // Agrupadas por día: la semana se lee de arriba abajo, como en la puerta.
  const porDia = NOMBRE.map((nombre, i) => ({
    nombre,
    weekday: i + 1,
    franjas: slots.filter((s) => s.weekday === i + 1).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t.slots.title}</h1>
          <p className="mt-1 text-sm text-ink-300">{t.slots.subtitle}</p>
        </div>
        <Button onClick={() => setEditando({ ...VACIA })}>
          <Plus className="h-4 w-4" />
          {t.slots.add}
        </Button>
      </div>

      {slots.length === 0 && (
        <p className="rounded-2xl bg-white px-5 py-10 text-center text-sm text-ink-300 shadow-chip">
          {t.slots.empty}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {porDia
          .filter((d) => d.franjas.length > 0)
          .map((d) => (
            <li key={d.weekday} className="rounded-2xl bg-white p-4 shadow-chip">
              <p className="label mb-2">{d.nombre}</p>
              <ul className="divide-y divide-surface-line">
                {d.franjas.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2">
                    <CalendarClock className="h-4 w-4 shrink-0 text-ink-300" />
                    <button
                      type="button"
                      onClick={() => setEditando(s)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block text-sm font-bold tabular-nums text-ink-700">
                        {s.starts_at.slice(0, 5)} – {s.ends_at.slice(0, 5)}
                      </span>
                      <span className="block text-xs text-ink-300">
                        {s.capacity > 0 ? `${t.slots.capacity} ${s.capacity}` : t.slots.unlimited}
                        {!s.is_active && ` · ${t.common.inactive}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBorrando(s)}
                      className="icon-btn h-8 w-8 text-state-danger"
                      aria-label={t.common.delete}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
      </ul>

      <Sheet
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando?.id ? t.common.edit : t.slots.add}
        footer={
          <Button size="block" loading={guardando} onClick={guardar}>
            {t.common.save}
          </Button>
        }
      >
        {editando && (
          <div className="space-y-4">
            <Select
              label={t.slots.day}
              value={String(editando.weekday ?? 1)}
              onChange={(e) => setEditando({ ...editando, weekday: Number(e.target.value) })}
            >
              {NOMBRE.map((nombre, i) => (
                <option key={i} value={i + 1}>
                  {nombre}
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-4">
              <Input
                type="time"
                label={t.slots.from}
                value={(editando.starts_at ?? '10:00').slice(0, 5)}
                onChange={(e) => setEditando({ ...editando, starts_at: e.target.value })}
              />
              <Input
                type="time"
                label={t.slots.to}
                value={(editando.ends_at ?? '12:00').slice(0, 5)}
                onChange={(e) => setEditando({ ...editando, ends_at: e.target.value })}
              />
            </div>

            <Input
              type="number"
              min={0}
              label={t.slots.capacity}
              hint={t.slots.capacityHint}
              value={String(editando.capacity ?? 0)}
              onChange={(e) => setEditando({ ...editando, capacity: Number(e.target.value) })}
            />

            <Switch
              label={t.slots.active}
              checked={editando.is_active ?? true}
              onChange={(v) => setEditando({ ...editando, is_active: v })}
            />
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={borrando !== null}
        onClose={() => setBorrando(null)}
        onConfirm={borrar}
        title={t.common.delete}
        message={
          borrando
            ? `${NOMBRE[borrando.weekday - 1]} · ${borrando.starts_at.slice(0, 5)} – ${borrando.ends_at.slice(0, 5)}`
            : ''
        }
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={guardando}
      />
    </div>
  );
}
