'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { setCustomerLocation, detectCity } from '@/app/actions/location';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

export type CityOption = { city: string; city_slug: string; restaurants: number };

/**
 * Selector de ciudad y dirección de entrega.
 *
 * La ciudad manda: la portada solo muestra restaurantes de la ciudad elegida,
 * así que este control ocupa el lugar destacado de la cabecera.
 */
export function LocationPicker({
  cities,
  current,
  variant = 'header',
}: {
  cities: CityOption[];
  current: { city: string; citySlug: string; address: string | null } | null;
  variant?: 'header' | 'inline';
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [address, setAddress] = useState(current?.address ?? '');
  const [selected, setSelected] = useState(current?.citySlug ?? '');
  const [locating, setLocating] = useState(false);
  const [pending, startTransition] = useTransition();

  const visible = cities.filter((c) =>
    c.city.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function save(citySlug: string, city: string) {
    startTransition(async () => {
      await setCustomerLocation({ city, citySlug, address });
      setOpen(false);
      router.refresh();
    });
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast(t.location.geolocationUnavailable, 'error');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const result = await detectCity(position.coords.latitude, position.coords.longitude);
        setLocating(false);

        if (!result.ok) {
          toast(t.location.noCityNearby, 'error');
          return;
        }
        setSelected(result.citySlug);
        save(result.citySlug, result.city);
        toast(`${t.location.detected}: ${result.city}`, 'success');
      },
      () => {
        setLocating(false);
        toast(t.location.permissionDenied, 'error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  const label = current?.city ?? t.location.chooseCity;
  // La dirección guardada es lo que de verdad confirma al cliente que pedirá
  // donde quiere, así que se muestra debajo de la ciudad cuando la hay.
  const detail = current?.address ?? (current ? null : t.location.chooseCityHint);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group flex min-w-0 items-center gap-2 text-left',
          variant === 'inline' && 'rounded-xl bg-surface-field px-4 py-3',
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
          <MapPin className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">
            {t.storefront.deliverTo}
          </span>
          <span className="block truncate text-sm font-semibold text-ink-600 group-hover:text-ink">
            {label}
            <span className="ml-1 font-normal text-ink-300">▾</span>
          </span>
          {detail && (
            <span className="block truncate text-xs text-ink-300">{detail}</span>
          )}
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t.location.title}>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating || pending}
          className="mb-5 flex w-full items-center gap-3 rounded-xl border border-brand/30 bg-brand-50 px-4 py-3.5 text-left transition-colors hover:bg-brand-100 disabled:opacity-60"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand">
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-brand-700">{t.location.useMyLocation}</span>
            <span className="block text-xs text-brand-600/80">{t.location.useMyLocationHint}</span>
          </span>
        </button>

        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          label={t.location.address}
          placeholder={t.location.addressPlaceholder}
          icon={<MapPin className="h-4 w-4" />}
          autoComplete="street-address"
        />

        <div className="mt-5">
          <span className="label">{t.location.city}</span>

          {cities.length > 6 && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.location.searchCity}
                aria-label={t.location.searchCity}
                className="w-full rounded-xl bg-surface-field py-3 pl-10 pr-4 text-sm text-ink placeholder:text-ink-400 focus:bg-white focus:ring-1 focus:ring-brand/30"
              />
            </div>
          )}

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-300">{t.location.noCities}</p>
          ) : (
            <ul className="max-h-[45vh] space-y-2 overflow-y-auto">
              {visible.map((option) => {
                const active = selected === option.city_slug;
                return (
                  <li key={option.city_slug}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(option.city_slug);
                        save(option.city_slug, option.city);
                      }}
                      disabled={pending}
                      className={cn(
                        'flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left transition-colors',
                        active
                          ? 'bg-brand-50 text-brand-700'
                          : 'bg-surface-field text-ink hover:bg-surface-muted',
                      )}
                    >
                      <span>
                        <span className="block text-sm font-bold">{option.city}</span>
                        <span className="block text-xs text-ink-300">
                          {option.restaurants} {t.admin.restaurants.toLowerCase()}
                        </span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {current && (
          <Button
            className="mt-5 w-full"
            variant="ghost"
            loading={pending}
            onClick={() => save(current.citySlug, current.city)}
          >
            {t.location.saveAddress}
          </Button>
        )}
      </Sheet>
    </>
  );
}
