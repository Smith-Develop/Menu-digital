'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Bike, Car, Footprints, Truck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { registerAsCourier } from '@/app/courier/actions';
import { VEHICLES, type Vehicle } from '@/lib/courier-vehicles';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

const ICONS: Record<Vehicle, typeof Bike> = {
  foot: Footprints,
  bike: Bike,
  moto: Truck,
  car: Car,
};

/** Alta de repartidor: el propio usuario crea su ficha. */
export function CourierOnboarding() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  const [vehicle, setVehicle] = useState<Vehicle>('moto');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const result = await registerAsCourier({ phone, vehicle, city });
    setLoading(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  const LABELS: Record<Vehicle, string> = {
    foot: t.courier.foot,
    bike: t.courier.bike,
    moto: t.courier.moto,
    car: t.courier.car,
  };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-5 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">{t.courier.registerTitle}</h1>
      <p className="mt-1.5 text-sm text-ink-300">{t.courier.registerHint}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5 rounded-2xl bg-white p-6 shadow-chip">
        <div>
          <span className="label">{t.courier.vehicle}</span>
          <div className="grid grid-cols-4 gap-2">
            {VEHICLES.map((option) => {
              const Icon = ICONS[option];
              const active = vehicle === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setVehicle(option)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 px-2 py-4 text-xs font-bold transition-colors',
                    active
                      ? 'border-brand bg-brand-50 text-brand-700'
                      : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {LABELS[option]}
                </button>
              );
            })}
          </div>
        </div>

        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          label={t.auth.phone}
          type="tel"
          placeholder="+34 600 000 000"
        />
        <Input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          label={t.location.city}
          placeholder="Madrid"
        />

        <Button type="submit" size="block" loading={loading}>
          {t.courier.registerCta}
        </Button>
      </form>
    </div>
  );
}
