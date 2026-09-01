'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Images, Megaphone, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select, Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { MoneyInput } from '@/components/ui/money-input';
import {
  saveSponsorshipOffer,
  deleteSponsorshipOffer,
  activateSponsorship,
} from '@/app/admin/actions';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type Offer = {
  id: string;
  citySlug: string | null;
  kind: Enums<'sponsorship_kind'>;
  priceCents: number;
  currency: string;
  slots: number;
  isActive: boolean;
};

export type Reserved = {
  id: string;
  name: string;
  kind: string;
  city: string | null;
  starts_on: string;
  ends_on: string;
  days: number;
  cents: number;
};

const VACIA = {
  citySlug: '',
  kind: 'listing' as Enums<'sponsorship_kind'>,
  priceCents: 0,
  currency: 'EUR',
  slots: 3,
  isActive: true,
};

/**
 * Lo que la plataforma vende en la portada, y lo que está esperando cobro.
 *
 * Van juntos porque son la misma conversación: cuánto se ofrece decide cuánto
 * vale, y lo reservado sin cobrar es el trabajo pendiente de hoy.
 */
export function SponsorshipsAdmin({
  offers,
  reserved,
  cities,
}: {
  offers: Offer[];
  reserved: Reserved[];
  cities: { slug: string; name: string }[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [editando, setEditando] = useState<(typeof VACIA & { id?: string }) | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function guardar() {
    if (!editando) return;
    setOcupado('guardar');
    const result = await saveSponsorshipOffer({
      id: editando.id,
      city_slug: editando.citySlug || null,
      kind: editando.kind,
      price_cents: editando.priceCents,
      currency: editando.currency,
      slots: editando.slots,
      is_active: editando.isActive,
    });
    setOcupado(null);

    if (!result.ok) {
      toast(result.error === 'OFFER_DUPLICATE' ? t.slots.duplicate : t.common.error, 'error');
      return;
    }
    setEditando(null);
    router.refresh();
  }

  async function borrar(id: string) {
    setOcupado(id);
    const result = await deleteSponsorshipOffer(id);
    setOcupado(null);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  async function encender(row: Reserved) {
    setOcupado(row.id);
    const result = await activateSponsorship(row.id);
    setOcupado(null);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(`${t.sponsor.activated}: ${formatMoney(result.data.totalCents, 'EUR')}`, 'success');
    router.refresh();
  }

  const nombreCiudad = (slug: string | null) =>
    slug ? (cities.find((c) => c.slug === slug)?.name ?? slug) : t.sponsor.allCities;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
              <Megaphone className="h-4 w-4 text-ink-300" />
              {t.sponsor.offers}
            </h2>
            <p className="mb-3 mt-1 text-xs text-ink-300">{t.sponsor.offersHint}</p>
          </div>
          <button
            type="button"
            onClick={() => setEditando({ ...VACIA })}
            className="btn-soft shrink-0 px-3 py-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.sponsor.newOffer}
          </button>
        </div>

        {offers.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-300">{t.analytics.noData}</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {offers.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-field text-ink-400">
                  {o.kind === 'banner' ? (
                    <Images className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditando({
                      id: o.id,
                      citySlug: o.citySlug ?? '',
                      kind: o.kind,
                      priceCents: o.priceCents,
                      currency: o.currency,
                      slots: o.slots,
                      isActive: o.isActive,
                    })
                  }
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-semibold text-ink-700">
                    {nombreCiudad(o.citySlug)}
                  </span>
                  <span className="block text-xs text-ink-300">
                    {o.kind === 'banner' ? t.sponsor.banner : t.sponsor.listing} ·{' '}
                    {t.sponsor.slots}: {o.slots}
                    {!o.isActive && ` · ${t.common.inactive}`}
                  </span>
                </button>
                <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                  {formatMoney(o.priceCents, o.currency)}
                </span>
                <button
                  type="button"
                  disabled={ocupado === o.id}
                  onClick={() => borrar(o.id)}
                  className="icon-btn h-8 w-8 text-state-danger disabled:opacity-40"
                  aria-label={t.common.delete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="font-display text-base font-bold text-ink-700">{t.sponsor.pending}</h2>
        <p className="mb-3 mt-1 text-xs text-ink-300">{t.sponsor.pendingHint}</p>

        {reserved.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-300">{t.sponsor.noPending}</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {reserved.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-700">{r.name}</span>
                  <span className="block text-xs text-ink-300">
                    {r.kind === 'banner' ? t.sponsor.banner : t.sponsor.listing} ·{' '}
                    {formatDate(r.starts_on, locale)} – {formatDate(r.ends_on, locale)}
                  </span>
                </span>
                <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                  {formatMoney(r.cents, 'EUR')}
                </span>
                <button
                  type="button"
                  disabled={ocupado === r.id}
                  onClick={() => encender(r)}
                  className="btn-soft shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t.sponsor.activate}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={t.sponsor.newOffer}
        footer={
          <Button size="block" loading={ocupado === 'guardar'} onClick={guardar}>
            {t.common.save}
          </Button>
        }
      >
        {editando && (
          <div className="space-y-4">
            <Select
              label={t.sponsor.city}
              value={editando.citySlug}
              onChange={(e) => setEditando({ ...editando, citySlug: e.target.value })}
            >
              <option value="">{t.sponsor.allCities}</option>
              {cities.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select
              label={t.sponsor.kind}
              value={editando.kind}
              onChange={(e) =>
                setEditando({ ...editando, kind: e.target.value as Enums<'sponsorship_kind'> })
              }
            >
              <option value="listing">{t.sponsor.listing}</option>
              <option value="banner">{t.sponsor.banner}</option>
            </Select>

            <div>
              <label htmlFor="precio-dia" className="label">
                {t.sponsor.pricePerDay}
              </label>
              <MoneyInput
                id="precio-dia"
                value={editando.priceCents}
                decimals={2}
                onChange={(cents) => setEditando({ ...editando, priceCents: cents })}
              />
            </div>

            <Input
              type="number"
              min={1}
              max={50}
              label={t.sponsor.slots}
              hint={t.sponsor.slotsHint}
              value={String(editando.slots)}
              onChange={(e) => setEditando({ ...editando, slots: Number(e.target.value) })}
            />

            <Switch
              label={t.common.active}
              checked={editando.isActive}
              onChange={(v) => setEditando({ ...editando, isActive: v })}
            />
          </div>
        )}
      </Sheet>
    </div>
  );
}
