'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, MapPin, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { saveAddress, makeDefaultAddress, deleteAddress } from '@/app/actions/addresses';
import type { PaisDisponible } from '@/lib/queries/places';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import {
  AddressFields,
  EMPTY_ADDRESS,
  addressIsUsable,
  type AddressDraft,
} from './address-fields';
import { toDraft, type SavedAddress } from './address-picker';

/**
 * Las direcciones del cliente, fuera del pedido.
 *
 * Existe porque una dirección se escribe una vez y se usa muchas: pedirla en
 * cada compra es lo que llevó a aceptar cualquier cosa con tal de avanzar. Aquí
 * se corrige con calma lo que en el checkout se escribe con prisa.
 */
export function AddressBook({
  addresses,
  countries,
  defaultCity,
}: {
  addresses: SavedAddress[];
  countries: PaisDisponible[];
  defaultCity: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editando, setEditando] = useState<AddressDraft | null>(null);

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
      });

      if (!resultado.ok) {
        toast(
          resultado.error === 'ADDRESS_INCOMPLETE' ? t.address.incomplete : t.common.error,
          'error',
        );
        return;
      }

      setEditando(null);
      toast(t.address.saved, 'success');
      router.refresh();
    });
  }

  function marcar(id: string) {
    startTransition(async () => {
      const r = await makeDefaultAddress(id);
      if (!r.ok) {
        toast(t.common.error, 'error');
        return;
      }
      router.refresh();
    });
  }

  function borrar(id: string) {
    if (!confirm(t.address.confirmRemove)) return;
    startTransition(async () => {
      const r = await deleteAddress(id);
      if (!r.ok) {
        toast(t.common.error, 'error');
        return;
      }
      toast(t.address.removed, 'success');
      router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">{t.address.title}</h2>
          <p className="mt-0.5 text-sm text-ink-300">{t.address.subtitle}</p>
        </div>
        {!editando && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditando({ ...EMPTY_ADDRESS, city: defaultCity ?? '' })}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
            {t.address.add}
          </Button>
        )}
      </div>

      {editando && (
        <div className="mt-4 rounded-2xl bg-surface-field p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-bold text-ink">
              {editando.id ? t.address.edit : t.address.add}
            </p>
            <button
              type="button"
              onClick={() => setEditando(null)}
              className="rounded-lg p-1 text-ink-300 hover:text-ink"
              aria-label={t.address.cancel}
            >
              <X className="h-4 w-4" />
            </button>
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
      )}

      <div className="mt-4 space-y-2">
        {addresses.length === 0 && !editando && (
          <p className="rounded-xl bg-surface-field px-4 py-6 text-center text-sm text-ink-300">
            {t.address.none}
          </p>
        )}

        {addresses.map((a) => (
          <div
            key={a.id}
            className={cn(
              'flex items-start gap-3 rounded-xl px-4 py-3',
              a.is_default ? 'bg-brand-50 ring-1 ring-brand/30' : 'bg-surface-field',
            )}
          >
            <MapPin
              className={cn('mt-0.5 h-4 w-4 shrink-0', a.is_default ? 'text-brand' : 'text-ink-300')}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-700">
                {a.label || t.address.home}
                {a.is_default && (
                  <span className="inline-flex items-center gap-1 text-ink-300">
                    <Star className="h-3 w-3 fill-current" />
                    {t.address.isDefault}
                  </span>
                )}
              </p>
              <p className="text-sm font-semibold text-ink-700">{a.full_line}</p>
              {a.notes && <p className="text-xs text-ink-300">{a.notes}</p>}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {!a.is_default && (
                <button
                  type="button"
                  onClick={() => marcar(a.id)}
                  disabled={pending}
                  title={t.address.makeDefault}
                  className="rounded-lg p-2 text-ink-300 hover:text-brand"
                >
                  <Star className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditando(toDraft(a))}
                className="rounded-lg p-2 text-ink-300 hover:text-ink"
                title={t.address.edit}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => borrar(a.id)}
                disabled={pending}
                className="rounded-lg p-2 text-ink-300 hover:text-state-danger"
                title={t.address.remove}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
