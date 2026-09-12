'use client';

import { Home, Briefcase, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { CountryCityFields } from '@/components/ui/location-fields';
import type { PaisDisponible } from '@/lib/queries/places';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type AddressDraft = {
  id?: string;
  label: string;
  country: string;
  city: string;
  neighborhood: string;
  street: string;
  details: string;
  notes: string;
};

export const EMPTY_ADDRESS: AddressDraft = {
  label: '',
  country: '',
  city: '',
  neighborhood: '',
  street: '',
  details: '',
  notes: '',
};

/**
 * ¿Está esta dirección lo bastante completa para llevar algo a ella?
 *
 * Gemela de `address_looks_complete()` en la base, que es la que manda. Está
 * repetida aquí para poder avisar mientras se escribe, en vez de dejar que el
 * cliente termine el pedido y reciba un error de Postgres al final.
 */
export function addressIsUsable(d: AddressDraft): boolean {
  const calle = d.street.trim();
  const ciudad = d.city.trim();
  return (
    calle.length >= 5 &&
    ciudad.length >= 2 &&
    calle.toLowerCase() !== ciudad.toLowerCase()
  );
}

/** Cómo se lee la dirección de un tirón, igual que la compone la base. */
export function addressLine(d: AddressDraft): string {
  return [d.street, d.details, d.neighborhood, d.city]
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Los campos de una dirección de entrega.
 *
 * Se separan en piezas y no en una línea libre porque una línea libre admite
 * «Dabeiba», y eso es lo que el repartidor se encontraba al llegar. Con la
 * calle en su propio campo y obligatoria, el hueco se ve.
 *
 * El barrio es opcional a propósito: en Colombia y en Honduras es media
 * dirección, y en España sobra. Exigirlo en todas partes obliga a inventárselo
 * en alguna.
 */
export function AddressFields({
  value,
  onChange,
  countries,
}: {
  value: AddressDraft;
  onChange: (d: AddressDraft) => void;
  countries: PaisDisponible[];
}) {
  const t = useT();
  const set = <K extends keyof AddressDraft>(key: K, v: AddressDraft[K]) =>
    onChange({ ...value, [key]: v });

  const atajos = [
    { id: t.address.home, icon: Home },
    { id: t.address.work, icon: Briefcase },
  ];

  return (
    <div className="space-y-4">
      <div>
        <p className="label">{t.address.label}</p>
        <div className="flex flex-wrap items-center gap-2">
          {atajos.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => set('label', value.label === id ? '' : id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors',
                value.label === id
                  ? 'bg-brand text-white'
                  : 'bg-surface-field text-ink-500 hover:bg-surface-muted',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {id}
            </button>
          ))}
          <input
            value={atajos.some((a) => a.id === value.label) ? '' : value.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder={t.address.labelPlaceholder}
            maxLength={40}
            className="min-w-0 flex-1 rounded-xl bg-surface-field px-3 py-2 text-xs font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-300"
          />
        </div>
      </div>

      <CountryCityFields
        countries={countries}
        country={value.country}
        city={value.city}
        onCountry={(code) => set('country', code)}
        onCity={(nombre) => set('city', nombre)}
        labels={{
          country: t.place.country,
          city: t.place.city,
          otherCity: t.place.otherCity,
          cityFree: t.place.cityFree,
        }}
      />

      {/* La calle es lo único obligatorio además de la ciudad, y es justo lo
          que faltaba: sin ella no hay puerta a la que llamar. */}
      <Input
        value={value.street}
        onChange={(e) => set('street', e.target.value)}
        label={t.address.street}
        placeholder={t.address.streetPlaceholder}
        autoComplete="street-address"
        icon={<MapPin className="h-4 w-4" />}
        maxLength={160}
        error={
          value.street.trim().length > 0 && !addressIsUsable(value)
            ? t.address.streetTooVague
            : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          value={value.details}
          onChange={(e) => set('details', e.target.value)}
          label={`${t.address.details} (${t.common.optional})`}
          placeholder={t.address.detailsPlaceholder}
          maxLength={80}
        />
        <Input
          value={value.neighborhood}
          onChange={(e) => set('neighborhood', e.target.value)}
          label={`${t.address.neighborhood} (${t.common.optional})`}
          placeholder={t.address.neighborhoodPlaceholder}
          maxLength={80}
        />
      </div>

      {/* Lo que el repartidor necesita para encontrar el portal. Se guarda con
          la dirección, no con el pedido: quien escribió «portón verde» una vez
          no tiene que repetirlo cada semana. */}
      <Input
        value={value.notes}
        onChange={(e) => set('notes', e.target.value)}
        label={`${t.address.notes} (${t.common.optional})`}
        placeholder={t.address.notesPlaceholder}
        maxLength={200}
      />
    </div>
  );
}
