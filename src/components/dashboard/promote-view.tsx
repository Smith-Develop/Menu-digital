'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Images, Megaphone, Sparkles, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { reserveSponsorship, cancelSponsorship } from '@/app/dashboard/actions';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type MySponsorship = {
  id: string;
  kind: Enums<'sponsorship_kind'>;
  startsOn: string;
  endsOn: string;
  days: number;
  totalCents: number;
  currency: string;
  status: Enums<'sponsorship_status'>;
};

type Hueco = {
  offered: boolean;
  slots?: number;
  taken?: number;
  free?: number;
  price_cents?: number;
  currency?: string;
  days?: number;
  total_cents?: number;
};

/** El día de hoy en ISO corto, que es lo que espera un input de fecha. */
function hoy(dias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Contratar un sitio destacado.
 *
 * La pantalla enseña el precio y el hueco antes de que nadie se comprometa, y
 * dice sin rodeos que lo comprado sale etiquetado. Es lo honesto y además lo
 * práctico: quien contrata esperando que no se note se va a enfadar el primer
 * día, y quien contrata sabiéndolo renueva.
 */
export function PromoteView({
  citySlug,
  cityName,
  hasBanners,
  mine,
}: {
  citySlug: string | null;
  cityName: string | null;
  hasBanners: boolean;
  mine: MySponsorship[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [kind, setKind] = useState<Enums<'sponsorship_kind'>>('listing');
  const [desde, setDesde] = useState(hoy(1));
  const [hasta, setHasta] = useState(hoy(7));
  const [hueco, setHueco] = useState<Hueco | null>(null);
  const [guardando, setGuardando] = useState(false);

  const consultar = useCallback(async () => {
    if (hasta < desde) {
      setHueco(null);
      return;
    }
    const { data } = await supabase.rpc('sponsorship_availability', {
      p_city_slug: citySlug,
      p_kind: kind,
      p_from: desde,
      p_to: hasta,
    });
    setHueco(data as unknown as Hueco);
  }, [supabase, citySlug, kind, desde, hasta]);

  useEffect(() => {
    consultar();
  }, [consultar]);

  async function reservar() {
    setGuardando(true);
    const result = await reserveSponsorship(kind, desde, hasta);
    setGuardando(false);

    if (!result.ok) {
      const textos = t.sponsor as unknown as Record<string, string>;
      toast(textos[result.error] ?? t.common.error, 'error');
      return;
    }
    toast(t.sponsor.afterReserve, 'success');
    router.refresh();
    consultar();
  }

  async function anular(id: string) {
    const result = await cancelSponsorship(id);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
    consultar();
  }

  const moneda = hueco?.currency ?? 'EUR';
  const sinHueco = hueco?.offered === true && (hueco.free ?? 0) <= 0;
  const rangoMalo = hasta < desde;

  const TIPOS = [
    { id: 'listing' as const, icon: Sparkles, label: t.sponsor.listing, hint: t.sponsor.listingHint },
    { id: 'banner' as const, icon: Images, label: t.sponsor.banner, hint: t.sponsor.bannerHint },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.sponsor.title}</h1>
        <p className="mt-1 text-sm text-ink-300">
          {t.sponsor.subtitle}
          {cityName ? ` · ${cityName}` : ''}
        </p>
      </div>

      <p className="rounded-2xl bg-surface-soft px-5 py-4 text-sm text-ink-400">
        {t.sponsor.honest}
      </p>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <div className="grid gap-3 sm:grid-cols-2">
            {TIPOS.map(({ id, icon: Icono, label, hint }) => {
              // El carrusel se vende, pero sin un banner publicado no hay nada
              // que poner en él: mejor decirlo antes que cobrarlo y dejarlo en
              // blanco.
              const imposible = id === 'banner' && !hasBanners;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={imposible}
                  onClick={() => setKind(id)}
                  className={cn(
                    'rounded-2xl border-2 p-4 text-left transition-colors disabled:opacity-50',
                    kind === id
                      ? 'border-brand bg-brand-50'
                      : 'border-surface-line bg-white hover:bg-surface-soft',
                  )}
                >
                  <Icono className={cn('h-5 w-5', kind === id ? 'text-brand-700' : 'text-ink-300')} />
                  <span className="mt-2 block text-sm font-bold text-ink-700">{label}</span>
                  <span className="mt-0.5 block text-xs text-ink-300">{hint}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Input
              type="date"
              label={t.sponsor.from}
              min={hoy()}
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
            <Input
              type="date"
              label={t.sponsor.to}
              min={desde}
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              error={rangoMalo ? t.sponsor.SPONSORSHIP_BAD_RANGE : null}
            />
          </div>

          {hueco?.offered === false ? (
            <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              {t.sponsor.noOffer}
            </p>
          ) : (
            hueco?.offered && (
              <div className="mt-5 space-y-2 rounded-xl bg-surface-field px-4 py-4">
                <p className="flex items-baseline justify-between text-sm text-ink-400">
                  <span>
                    {interpolate(t.sponsor.perDay, {
                      price: formatMoney(hueco.price_cents ?? 0, moneda),
                    })}
                  </span>
                  <span>
                    {hueco.days === 1
                      ? t.sponsor.oneDay
                      : interpolate(t.sponsor.days, { n: hueco.days ?? 0 })}
                  </span>
                </p>
                <p className="flex items-baseline justify-between">
                  <span className="label mb-0">{t.sponsor.total}</span>
                  <span className="font-display text-2xl font-bold tabular-nums text-ink">
                    {formatMoney(hueco.total_cents ?? 0, moneda)}
                  </span>
                </p>
                <p className={cn('text-xs', sinHueco ? 'font-bold text-state-danger' : 'text-ink-300')}>
                  {sinHueco
                    ? t.sponsor.full
                    : interpolate(t.sponsor.slotsLeft, {
                        n: hueco.free ?? 0,
                        total: hueco.slots ?? 0,
                      })}
                </p>
              </div>
            )
          )}

          <div className="mt-5">
            <Button
              size="block"
              loading={guardando}
              disabled={!hueco?.offered || sinHueco || rangoMalo}
              onClick={reservar}
            >
              <Megaphone className="h-4 w-4" />
              {t.sponsor.reserve}
            </Button>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <h2 className="mb-3 font-display text-base font-bold text-ink-700">{t.sponsor.mine}</h2>

          {mine.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-300">{t.sponsor.none}</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {mine.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ink-700">
                      {s.kind === 'listing' ? t.sponsor.listing : t.sponsor.banner}
                    </span>
                    <span className="block text-xs text-ink-300">
                      {formatDate(s.startsOn, locale)} – {formatDate(s.endsOn, locale)}
                    </span>
                    <span
                      className={cn(
                        'mt-1 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold',
                        s.status === 'active'
                          ? 'bg-state-success/10 text-state-success'
                          : s.status === 'reserved'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-surface-field text-ink-300',
                      )}
                    >
                      {s.status === 'active'
                        ? t.sponsor.active
                        : s.status === 'reserved'
                          ? t.sponsor.reserved
                          : t.sponsor.cancelled}
                    </span>
                  </span>
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                    {formatMoney(s.totalCents, s.currency)}
                  </span>
                  {s.status === 'reserved' && (
                    <button
                      type="button"
                      onClick={() => anular(s.id)}
                      className="icon-btn h-8 w-8 text-state-danger"
                      aria-label={t.common.cancel}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
