'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { FileUpload } from '@/components/dashboard/file-upload';
import { updateRestaurantSettings, updateRestaurantTheme } from '@/app/dashboard/actions';
import { ColorInput } from '@/components/ui/color-input';
import { brandCssVariables } from '@/lib/brand-theme';
import { CURRENCIES, formatAmount, parseAmount, getCurrency } from '@/lib/money';
import { useT } from '@/i18n/provider';

export type SettingsValues = {
  name: string;
  description: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  logoUrl: string | null;
  coverUrl: string | null;
  currency: string;
  currencyDecimals: number;
  timezone: string;
  cuisineTags: string[];
  avgPrepMinutes: number;
  deliveryFeeCents: number;
  minOrderCents: number;
  taxRate: number;
  dineinEnabled: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  acceptsCash: boolean;
  acceptsCard: boolean;
  acceptsTpv: boolean;
  isOpen: boolean;
  primaryColor: string;
  accentColor: string;
  textColor: string;
};

export function SettingsForm({
  restaurantId,
  initial,
}: {
  restaurantId: string;
  initial: SettingsValues;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);

  const decimals = getCurrency(values.currency).decimals;

  function set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    const result = await updateRestaurantSettings({
      name: values.name,
      description: values.description || null,
      phone: values.phone || null,
      address: values.address || null,
      city: values.city || null,
      country: values.country.toUpperCase().slice(0, 2),
      logo_url: values.logoUrl,
      cover_url: values.coverUrl,
      currency: values.currency,
      timezone: values.timezone,
      cuisine_tags: values.cuisineTags,
      avg_prep_minutes: values.avgPrepMinutes,
      delivery_fee_cents: values.deliveryFeeCents,
      min_order_cents: values.minOrderCents,
      tax_rate: values.taxRate,
      dinein_enabled: values.dineinEnabled,
      delivery_enabled: values.deliveryEnabled,
      pickup_enabled: values.pickupEnabled,
      accepts_cash: values.acceptsCash,
      accepts_card: values.acceptsCard,
      accepts_tpv: values.acceptsTpv,
      is_open: values.isOpen,
    });

    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
        <h2 className="font-display text-base font-bold text-ink-700">{t.common.name}</h2>

        <Input
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          label={t.auth.restaurantName}
          required
        />
        <Textarea
          value={values.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          label={t.common.description}
          rows={3}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <FileUpload
            bucket="restaurants"
            restaurantId={restaurantId}
            value={values.logoUrl}
            onChange={(url) => set('logoUrl', url)}
            label="Logotipo"
          />
          <FileUpload
            bucket="restaurants"
            restaurantId={restaurantId}
            value={values.coverUrl}
            onChange={(url) => set('coverUrl', url)}
            label="Portada"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            value={values.phone ?? ''}
            onChange={(e) => set('phone', e.target.value)}
            label={t.auth.phone}
            type="tel"
          />
          <Input
            value={values.city ?? ''}
            onChange={(e) => set('city', e.target.value)}
            label="Ciudad"
          />
        </div>

        <Input
          value={values.address ?? ''}
          onChange={(e) => set('address', e.target.value)}
          label="Dirección"
        />
      </section>

      <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
        <h2 className="font-display text-base font-bold text-ink-700">Pedidos y precios</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            value={values.currency}
            onChange={(e) => set('currency', e.target.value)}
            label="Divisa"
            hint="Los precios ya guardados se reinterpretan con los decimales de la nueva divisa."
          >
            {CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} · {currency.name} ({currency.symbol})
              </option>
            ))}
          </Select>
          <Input
            value={values.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            label="Zona horaria"
            placeholder="Europe/Madrid"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            defaultValue={formatAmount(values.deliveryFeeCents, decimals)}
            onBlur={(e) => set('deliveryFeeCents', parseAmount(e.target.value, decimals))}
            label={t.storefront.deliveryFee}
            inputMode="decimal"
          />
          <Input
            defaultValue={formatAmount(values.minOrderCents, decimals)}
            onBlur={(e) => set('minOrderCents', parseAmount(e.target.value, decimals))}
            label={t.storefront.minOrder}
            inputMode="decimal"
          />
          <Input
            type="number"
            value={Math.round(values.taxRate * 10000) / 100}
            onChange={(e) => set('taxRate', Number(e.target.value) / 100)}
            label="Impuesto (%)"
            step="0.01"
            min={0}
            max={100}
          />
        </div>

        <Input
          type="number"
          value={values.avgPrepMinutes}
          onChange={(e) => set('avgPrepMinutes', Number(e.target.value))}
          label={`${t.storefront.prepTime} (${t.common.min})`}
          min={1}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset className="rounded-xl bg-surface-field p-4">
            <legend className="label mb-0">{t.cart.orderType}</legend>
            <div className="mt-3 space-y-3">
              <Switch checked={values.dineinEnabled} onChange={(v) => set('dineinEnabled', v)} label={t.cart.dineIn} />
              <Switch checked={values.deliveryEnabled} onChange={(v) => set('deliveryEnabled', v)} label={t.cart.delivery} />
              <Switch checked={values.pickupEnabled} onChange={(v) => set('pickupEnabled', v)} label={t.cart.pickup} />
            </div>
          </fieldset>

          <fieldset className="rounded-xl bg-surface-field p-4">
            <legend className="label mb-0">{t.checkout.paymentMethod}</legend>
            <div className="mt-3 space-y-3">
              <Switch checked={values.acceptsCash} onChange={(v) => set('acceptsCash', v)} label={t.checkout.cash} />
              <Switch checked={values.acceptsCard} onChange={(v) => set('acceptsCard', v)} label={t.checkout.card} />
              <Switch checked={values.acceptsTpv} onChange={(v) => set('acceptsTpv', v)} label={t.checkout.tpv} />
            </div>
          </fieldset>
        </div>

        <div className="rounded-xl bg-surface-field p-4">
          <Switch
            checked={values.isOpen}
            onChange={(v) => set('isOpen', v)}
            label={values.isOpen ? t.storefront.open : t.storefront.closed}
          />
        </div>
      </section>

      <ThemeSection
        initial={{
          primaryColor: initial.primaryColor,
          accentColor: initial.accentColor,
          textColor: initial.textColor,
        }}
      />

      <Button type="submit" loading={saving} size="lg">
        {t.common.save}
      </Button>
    </form>
  );
}

/**
 * Colores de la tienda del restaurante.
 *
 * Se guarda aparte del resto de ajustes porque tiene su propia vista previa y
 * el dueño suele venir solo a tocar esto.
 */
function ThemeSection({
  initial,
}: {
  initial: { primaryColor: string; accentColor: string; textColor: string };
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [colors, setColors] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updateRestaurantTheme({
      primary_color: colors.primaryColor,
      accent_color: colors.accentColor,
      text_color: colors.textColor,
    });
    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'INVALID_COLOR' ? t.common.error : t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  return (
    <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
      <div>
        <h2 className="font-display text-base font-bold text-ink-700">{t.dashboard.appearance}</h2>
        <p className="mt-1 text-sm text-ink-300">{t.dashboard.appearanceHint}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="grid gap-5 sm:grid-cols-3">
          <ColorInput
            label={t.dashboard.primaryColor}
            value={colors.primaryColor}
            onChange={(v) => setColors({ ...colors, primaryColor: v })}
          />
          <ColorInput
            label={t.dashboard.accentColor}
            value={colors.accentColor}
            onChange={(v) => setColors({ ...colors, accentColor: v })}
          />
          <ColorInput
            label={t.dashboard.textColor}
            value={colors.textColor}
            onChange={(v) => setColors({ ...colors, textColor: v })}
          />
        </div>

        <div
          className="rounded-2xl border border-surface-line p-4"
          style={brandCssVariables(colors) as React.CSSProperties}
        >
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-300">
            {t.admin.preview}
          </p>
          <p className="mb-3 font-display text-base font-bold text-ink">Pizza Margherita</p>
          <div className="mb-3 flex gap-2">
            <span className="chip bg-accent text-accent-contrast">26 cm</span>
            <span className="chip bg-surface-field text-ink-600">33 cm</span>
          </div>
          <button type="button" className="btn-primary w-full text-xs">
            {t.product.addToCart}
          </button>
        </div>
      </div>

      <Button type="button" onClick={save} loading={saving}>
        {t.common.save}
      </Button>
    </section>
  );
}
