'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { CountryCityFields } from '@/components/ui/location-fields';
import { createRestaurantAsAdmin, updateRestaurantProfile } from '@/app/admin/actions';
import { CURRENCIES } from '@/lib/money';
import type { PaisDisponible } from '@/lib/queries/places';
import { useT } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type PlanSimple = { id: string; name: string };

const NUEVO = {
  name: '',
  ownerEmail: '',
  // Sin país elegido: que lo diga quien da de alta, en vez de heredar el de
  // quien escribió el código.
  country: '',
  city: '',
  currency: 'EUR',
  timezone: 'Europe/Madrid',
  businessType: 'restaurant' as Enums<'business_type'>,
  planId: '',
};

/** Los campos de sitio, que se usan igual al crear y al editar. */
function CamposDeSitio({
  valores,
  set,
  countries,
  t,
}: {
  valores: { country: string; city: string; currency: string; timezone: string };
  set: (cambios: Partial<{ country: string; city: string; currency: string; timezone: string }>) => void;
  countries: PaisDisponible[];
  t: ReturnType<typeof useT>;
}) {
  return (
    <>
      <CountryCityFields
        countries={countries}
        country={valores.country}
        city={valores.city}
        onCountry={(code) => set({ country: code })}
        onCity={(nombre) => set({ city: nombre })}
        // Elegir país propone divisa y hora: son tres cosas que casi siempre
        // van juntas y preguntarlas por separado sólo produce despistes.
        onSuggest={(pais) =>
          set({ country: pais.code, currency: pais.currency, timezone: pais.timezone })
        }
        labels={{
          country: t.place.country,
          city: t.place.city,
          otherCity: t.place.otherCity,
          cityFree: t.place.cityFree,
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Divisa"
          value={valores.currency}
          onChange={(e) => set({ currency: e.target.value })}
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name} ({c.symbol})
            </option>
          ))}
        </Select>
        <Input
          label="Zona horaria"
          value={valores.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
        />
      </div>
    </>
  );
}

/**
 * Dar de alta un restaurante desde la plataforma.
 *
 * Antes sólo podía nacer registrándose desde fuera, lo que obligaba a pedirle
 * al cliente que se apuntara él y después ir a buscarle en la lista. Quien
 * vende necesita poder dejarlo montado antes de la primera llamada.
 */
export function NewRestaurantButton({
  plans,
  countries,
}: {
  plans: PlanSimple[];
  countries: PaisDisponible[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState(NUEVO);
  const [guardando, setGuardando] = useState(false);

  const set = (cambios: Partial<typeof NUEVO>) =>
    setValores((actual) => ({ ...actual, ...cambios }));

  async function crear() {
    setGuardando(true);
    const result = await createRestaurantAsAdmin({
      name: valores.name.trim(),
      ownerEmail: valores.ownerEmail.trim().toLowerCase(),
      country: valores.country,
      city: valores.city || null,
      currency: valores.currency,
      timezone: valores.timezone,
      businessType: valores.businessType,
      planId: valores.planId || null,
    });
    setGuardando(false);

    if (!result.ok) {
      const textos = t.adminShop as unknown as Record<string, string>;
      toast(textos[result.error] ?? result.error, 'error');
      return;
    }
    toast(result.data.invited ? t.adminShop.invited : t.adminShop.created, 'success');
    setAbierto(false);
    setValores(NUEVO);
    router.push(`/admin/restaurants/${result.data.id}`);
  }

  const listo = valores.name.trim().length > 1 && valores.ownerEmail.includes('@');

  return (
    <>
      <Button onClick={() => setAbierto(true)}>
        <Plus className="h-4 w-4" />
        {t.adminShop.newRestaurant}
      </Button>

      <Sheet
        open={abierto}
        onClose={() => setAbierto(false)}
        title={t.adminShop.newRestaurant}
        footer={
          <Button size="block" loading={guardando} disabled={!listo} onClick={crear}>
            <Store className="h-4 w-4" />
            {t.adminShop.create}
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-surface-soft px-4 py-3 text-xs text-ink-400">
            {t.adminShop.newHint}
          </p>

          <Input
            label={t.common.name}
            value={valores.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="La Trattoria"
            autoFocus
          />
          <Input
            label={t.adminShop.ownerEmail}
            hint={t.adminShop.ownerHint}
            type="email"
            value={valores.ownerEmail}
            onChange={(e) => set({ ownerEmail: e.target.value })}
          />

          <CamposDeSitio valores={valores} set={set} countries={countries} t={t} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t.adminShop.businessType}
              value={valores.businessType}
              onChange={(e) =>
                set({ businessType: e.target.value as Enums<'business_type'> })
              }
            >
              <option value="restaurant">{t.business.restaurant}</option>
              <option value="grocery">{t.business.grocery}</option>
            </Select>
            <Select
              label={t.adminShop.plan}
              value={valores.planId}
              onChange={(e) => set({ planId: e.target.value })}
            >
              <option value="">{t.adminShop.noPlan}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Sheet>
    </>
  );
}

export type FichaValores = {
  name: string;
  slug: string;
  description: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  city: string;
  currency: string;
  timezone: string;
  documentType: string;
  documentNumber: string;
  businessType: Enums<'business_type'>;
  isActive: boolean;
};

/**
 * La ficha completa del restaurante.
 *
 * Lo que el local puede cambiar por su cuenta lo cambia en su panel; aquí está
 * todo, incluido lo que allí no aparece a propósito: el identificador de la
 * tienda y el tipo de negocio.
 */
export function RestaurantProfileForm({
  restaurantId,
  initial,
  countries,
}: {
  restaurantId: string;
  initial: FichaValores;
  countries: PaisDisponible[];
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [valores, setValores] = useState(initial);
  const [guardando, setGuardando] = useState(false);

  const set = (cambios: Partial<FichaValores>) =>
    setValores((actual) => ({ ...actual, ...cambios }));

  async function guardar() {
    setGuardando(true);
    const result = await updateRestaurantProfile(restaurantId, {
      name: valores.name.trim(),
      slug: valores.slug.trim(),
      description: valores.description.trim() || null,
      email: valores.email.trim() || null,
      phone: valores.phone.trim() || null,
      address: valores.address.trim() || null,
      country: valores.country,
      city: valores.city.trim() || null,
      currency: valores.currency,
      timezone: valores.timezone,
      document_type: valores.documentType.trim() || null,
      document_number: valores.documentNumber.trim() || null,
      business_type: valores.businessType,
      is_active: valores.isActive,
    });
    setGuardando(false);

    if (!result.ok) {
      toast(result.error === 'SLUG_TAKEN' ? t.adminShop.slugTaken : result.error, 'error');
      return;
    }
    toast(t.adminShop.saved, 'success');
    router.refresh();
  }

  return (
    <section className="rounded-2xl bg-white p-6 shadow-chip">
      <h2 className="font-display text-base font-bold text-ink-700">{t.adminShop.profile}</h2>
      <p className="mb-5 mt-1 text-sm text-ink-300">{t.adminShop.profileHint}</p>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t.common.name}
            value={valores.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          <Input
            label={t.adminShop.slug}
            hint={t.adminShop.slugHint}
            className="font-mono"
            value={valores.slug}
            onChange={(e) =>
              set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
            }
          />
        </div>

        <Textarea
          label={t.common.description}
          rows={2}
          value={valores.description}
          onChange={(e) => set({ description: e.target.value })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t.auth.email}
            type="email"
            value={valores.email}
            onChange={(e) => set({ email: e.target.value })}
          />
          <Input
            label={t.auth.phone}
            type="tel"
            value={valores.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </div>

        <CamposDeSitio
          valores={valores}
          set={(cambios) => set(cambios)}
          countries={countries}
          t={t}
        />

        <Input
          label={t.dashboard.address}
          value={valores.address}
          onChange={(e) => set({ address: e.target.value })}
        />

        <div className="grid gap-4 sm:grid-cols-[minmax(0,180px)_1fr]">
          <Input
            label={t.adminShop.docType}
            placeholder="NIT, NIF, RTN…"
            value={valores.documentType}
            onChange={(e) => set({ documentType: e.target.value })}
          />
          <Input
            label={t.adminShop.docNumber}
            value={valores.documentNumber}
            onChange={(e) => set({ documentNumber: e.target.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t.adminShop.businessType}
            value={valores.businessType}
            onChange={(e) => set({ businessType: e.target.value as Enums<'business_type'> })}
          >
            <option value="restaurant">{t.business.restaurant}</option>
            <option value="grocery">{t.business.grocery}</option>
          </Select>
          <div className="flex items-end pb-3">
            <Switch
              label={t.common.active}
              checked={valores.isActive}
              onChange={(v) => set({ isActive: v })}
            />
          </div>
        </div>

        <Button loading={guardando} onClick={guardar}>
          {t.adminShop.saveProfile}
        </Button>
      </div>
    </section>
  );
}
