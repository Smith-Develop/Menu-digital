'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Bike, MapPin, Package, Star } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/misc';
import { listCourierDeliveries, type CourierDelivery } from '@/app/actions/couriers';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';
import { initials } from '@/lib/utils';

export type CourierCard = {
  courierId: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatar?: string | null;
  vehicle: string;
  status: string;
  deliveries: number;
  rating?: number | null;
};

/**
 * Ficha de un repartidor con lo que ha entregado.
 *
 * El historial se pide al abrir, no al pintar la lista: son consultas por
 * repartidor y cargarlas todas de golpe para una ficha que quizá nadie abra
 * sería trabajo tirado.
 */
export function CourierSheet({
  courier,
  onClose,
  currency,
  currencyDecimals,
}: {
  courier: CourierCard | null;
  onClose: () => void;
  currency: string;
  currencyDecimals: number;
}) {
  const { t, locale } = useI18n();
  const [entregas, setEntregas] = useState<CourierDelivery[] | null>(null);

  useEffect(() => {
    if (!courier) {
      setEntregas(null);
      return;
    }
    let vivo = true;
    void listCourierDeliveries(courier.courierId).then((filas) => {
      if (vivo) setEntregas(filas);
    });
    return () => {
      vivo = false;
    };
  }, [courier]);

  return (
    <Sheet open={courier !== null} onClose={onClose} title={t.courier.courierCard}>
      {courier && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            {courier.avatar ? (
              <Image
                src={courier.avatar}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
                {initials(courier.name)}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold text-ink-700">
                {courier.name}
              </p>
              <p className="truncate text-xs text-ink-300">
                {courier.email}
                {courier.phone ? ` · ${courier.phone}` : ''}
              </p>
            </div>

            <Badge tone={courier.status === 'available' ? 'success' : 'neutral'}>
              {courier.status === 'available'
                ? t.courier.available
                : courier.status === 'busy'
                  ? t.courier.busy
                  : t.courier.offline}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Dato icono={<Package className="h-4 w-4" />} valor={String(courier.deliveries)} etiqueta={t.courier.deliveriesLabel} />
            <Dato
              icono={<Star className="h-4 w-4" />}
              valor={courier.rating ? courier.rating.toFixed(1) : '—'}
              etiqueta={t.courier.ratingLabel}
            />
            <Dato
              icono={<Bike className="h-4 w-4" />}
              valor={t.courier[courier.vehicle as 'moto'] ?? courier.vehicle}
              etiqueta={t.courier.vehicle}
            />
          </div>

          <div>
            <h3 className="mb-3 font-display text-sm font-bold text-ink-700">
              {t.courier.deliveryHistory}
            </h3>

            {entregas === null ? (
              <p className="py-6 text-center text-sm text-ink-300">{t.common.loading}</p>
            ) : entregas.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-300">{t.courier.noDeliveries}</p>
            ) : (
              <ul className="space-y-2">
                {entregas.map((entrega) => (
                  <li key={entrega.id} className="rounded-xl bg-surface-field p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-ink-700">#{entrega.code}</span>
                      <span className="text-sm font-bold text-ink">
                        {formatMoney(entrega.totalCents, currency, currencyDecimals)}
                      </span>
                    </div>
                    {entrega.address && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-300">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{entrega.address}</span>
                      </p>
                    )}
                    {entrega.completedAt && (
                      <p className="mt-0.5 text-xs text-ink-300">
                        {formatDateTime(entrega.completedAt, locale)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Dato({
  icono,
  valor,
  etiqueta,
}: {
  icono: React.ReactNode;
  valor: string;
  etiqueta: string;
}) {
  return (
    <div className="rounded-xl bg-surface-field p-3 text-center">
      <span className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink-400">
        {icono}
      </span>
      <p className="text-sm font-bold text-ink-700">{valor}</p>
      <p className="text-[11px] text-ink-300">{etiqueta}</p>
    </div>
  );
}
