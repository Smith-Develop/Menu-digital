'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, MapPin, Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { saveAddress } from '@/app/actions/addresses';
import type { PaisDisponible } from '@/lib/queries/places';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import {
  AddressFields,
  EMPTY_ADDRESS,
  addressIsUsable,
  type AddressDraft,
} from './address-fields';

export type SavedAddress = {
  id: string;
  label: string | null;
  country: string | null;
  city: string;
  neighborhood: string | null;
  street: string;
  details: string | null;
  notes: string | null;
  full_line: string;
  is_default: boolean;
};

export function toDraft(a: SavedAddress): AddressDraft {
  return {
    id: a.id,
    label: a.label ?? '',
    country: a.country ?? '',
    city: a.city,
    neighborhood: a.neighborhood ?? '',
    street: a.street,
    details: a.details ?? '',
    notes: a.notes ?? '',
  };
}

/**
 * Elegir a dónde se lleva el pedido.
 *
 * Antes esto no existía: el checkout componía «dirección, ciudad» con lo que
 * hubiera en la cookie de ubicación y, cuando no había dirección, mandaba la
 * ciudad sola y escondía el campo. El cliente nunca llegaba a ver que faltaba
 * algo, y el repartidor se encontraba «Dabeiba» como dirección de entrega.
 *
 * Ahora, si no hay una dirección utilizable, se pregunta. Y lo que se escribe
 * se guarda en la cuenta, que es la parte que faltaba para no volver a
 * preguntarlo la próxima vez.
 */
export function AddressPicker({
  addresses,
  countries,
  defaultCity,
  defaultCountry,
  selectedId,
  onSelect,
}: {
  addresses: SavedAddress[];
  countries: PaisDisponible[];
  defaultCity: string | null;
  defaultCountry: string | null;
  selectedId: string | null;
  onSelect: (id: string, line: string) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [lista, setLista] = useState(addresses);
  // Sin ninguna guardada se abre directamente el formulario: el paso de
  // "añadir dirección" sobra cuando no hay ninguna entre la que elegir.
  const [editando, setEditando] = useState<AddressDraft | null>(
    addresses.length === 0
      ? { ...EMPTY_ADDRESS, city: defaultCity ?? '', country: defaultCountry ?? '' }
      : null,
  );

  function guardar() {
    if (!editando || !addressIsUsable(editando)) {
      toast(t.address.incomplete, 'error');
      return;
    }

    startTransition(async () => {
      const resultado = await saveAddress({
        ...editando,
        label: editando.label || null,
        country: editando.country || null,
        neighborhood: editando.neighborhood || null,
        details: editando.details || null,
        notes: editando.notes || null,
        // La primera se queda de predeterminada sola, por el disparador de la
        // migración 0072. Marcarla aquí también cubre el caso de añadir otra
        // desde el checkout: si la estás usando para este pedido, es la buena.
        isDefault: true,
      });

      if (!resultado.ok) {
        toast(
          resultado.error === 'ADDRESS_INCOMPLETE' ? t.address.incomplete : t.common.error,
          'error',
        );
        return;
      }

      const guardada: SavedAddress = {
        id: resultado.id,
        label: editando.label || null,
        country: editando.country || null,
        city: editando.city.trim(),
        neighborhood: editando.neighborhood || null,
        street: editando.street.trim(),
        details: editando.details || null,
        notes: editando.notes || null,
        full_line: [editando.street, editando.details, editando.neighborhood, editando.city]
          .map((p) => p.trim())
          .filter(Boolean)
          .join(', '),
        is_default: true,
      };

      setLista((actual) => [guardada, ...actual.filter((a) => a.id !== guardada.id)]);
      setEditando(null);
      onSelect(guardada.id, guardada.full_line);
      toast(t.address.saved, 'success');
    });
  }

  if (editando) {
    return (
      <div className="rounded-2xl bg-surface-field p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">{t.address.deliverTo}</p>
            <p className="mt-0.5 text-xs text-ink-300">{t.address.deliverToHint}</p>
          </div>
          {lista.length > 0 && (
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="shrink-0 rounded-lg p-1 text-ink-300 hover:text-ink"
              aria-label={t.address.cancel}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <AddressFields value={editando} onChange={setEditando} countries={countries} />

        <Button
          type="button"
          onClick={guardar}
          disabled={pending || !addressIsUsable(editando)}
          className="mt-4 w-full"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : t.address.save}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {lista.map((a) => {
        const elegida = a.id === selectedId;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id, a.full_line)}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors',
              elegida ? 'bg-brand-50 ring-2 ring-brand' : 'bg-surface-field hover:bg-surface-muted',
            )}
          >
            <MapPin
              className={cn('mt-0.5 h-4 w-4 shrink-0', elegida ? 'text-brand' : 'text-ink-300')}
            />
            <span className="min-w-0 flex-1">
              {a.label && (
                <span className="block text-[11px] font-bold uppercase tracking-wide text-brand-700">
                  {a.label}
                </span>
              )}
              <span className="block text-sm font-semibold text-ink-700">{a.full_line}</span>
              {a.notes && <span className="block text-xs text-ink-300">{a.notes}</span>}
            </span>
            {elegida ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            ) : (
              <span
                role="presentation"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditando(toDraft(a));
                }}
                className="mt-0.5 shrink-0 text-ink-300 hover:text-ink"
              >
                <Pencil className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() =>
          setEditando({ ...EMPTY_ADDRESS, city: defaultCity ?? '', country: defaultCountry ?? '' })
        }
        className="inline-flex items-center gap-1.5 px-1 py-2 text-xs font-bold text-brand"
      >
        <Plus className="h-3.5 w-3.5" />
        {t.address.addAnother}
      </button>
    </div>
  );
}
