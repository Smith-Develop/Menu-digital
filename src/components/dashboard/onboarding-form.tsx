'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createRestaurant } from '@/app/onboarding/actions';
import { ShoppingBasket, UtensilsCrossed } from 'lucide-react';
import { CURRENCIES } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n/provider';

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(false);
  const [tipo, setTipo] = useState<'restaurant' | 'grocery'>('restaurant');
  const [dineIn, setDineIn] = useState(true);
  const [delivery, setDelivery] = useState(true);
  const [pickup, setPickup] = useState(true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    formData.set('business_type', tipo);
    formData.set('dinein', dineIn ? 'on' : 'off');
    formData.set('delivery', delivery ? 'on' : 'off');
    formData.set('pickup', pickup ? 'on' : 'off');

    const result = await createRestaurant(formData);
    if (!result.ok) {
      toast(t.common.error, 'error');
      setLoading(false);
      return;
    }

    toast(t.common.save, 'success');
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5 rounded-2xl bg-white p-6 shadow-chip">
      {/* Lo primero, porque cambia todo lo demás. */}
      <fieldset>
        <legend className="label mb-0">{t.business.type}</legend>
        <p className="mb-3 text-xs text-ink-300">{t.business.typeHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['restaurant', t.business.restaurant, t.business.restaurantHint, UtensilsCrossed],
              ['grocery', t.business.grocery, t.business.groceryHint, ShoppingBasket],
            ] as const
          ).map(([valor, titulo, pie, Icono]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setTipo(valor)}
              className={cn(
                'rounded-2xl border-2 p-4 text-left transition-colors',
                tipo === valor
                  ? 'border-brand bg-brand-50'
                  : 'border-surface-line bg-white hover:bg-surface-soft',
              )}
            >
              <Icono
                className={cn('h-5 w-5', tipo === valor ? 'text-brand-700' : 'text-ink-300')}
              />
              <span className="mt-2 block text-sm font-bold text-ink-700">{titulo}</span>
              <span className="mt-0.5 block text-xs text-ink-300">{pie}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <Input
        name="name"
        defaultValue={defaultName}
        label={t.auth.restaurantName}
        placeholder="La Trattoria"
        required
      />
      <Textarea
        name="description"
        label={`${t.common.description} (${t.common.optional})`}
        placeholder="Cocina italiana de barrio, pasta fresca cada mañana…"
        rows={3}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="phone" label={t.auth.phone} type="tel" placeholder="+34 910 123 456" />
        <Input name="city" label="Ciudad" placeholder="Madrid" />
      </div>

      <Input name="address" label="Dirección" placeholder="Calle Mayor 24" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="currency" label="Divisa" defaultValue="EUR">
          {CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} · {currency.name} ({currency.symbol})
            </option>
          ))}
        </Select>
        <Input name="country" label="País (ISO)" defaultValue="ES" maxLength={2} />
      </div>

      <fieldset className="rounded-xl bg-surface-field p-4">
        <legend className="label mb-0">{t.cart.orderType}</legend>
        <div className="mt-3 space-y-3">
          {tipo === 'restaurant' && (
            <Switch checked={dineIn} onChange={setDineIn} label={t.cart.dineIn} />
          )}
          <Switch checked={delivery} onChange={setDelivery} label={t.cart.delivery} />
          <Switch checked={pickup} onChange={setPickup} label={t.cart.pickup} />
        </div>
      </fieldset>

      <Button type="submit" size="block" loading={loading}>
        {t.common.create}
      </Button>
    </form>
  );
}
