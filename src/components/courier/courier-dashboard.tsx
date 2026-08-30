'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  Bike,
  Car,
  CheckCircle2,
  Footprints,
  MapPin,
  Package,
  Phone,
  Store,
  Truck,
} from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { setCourierStatus } from '@/app/courier/actions';
import { formatMoney } from '@/lib/money';
import { minutesSince, formatTime, cn } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import type { Enums } from '@/types/database';

export type DeliveryOrder = {
  id: string;
  code: string;
  status: Enums<'order_status'>;
  totalCents: number;
  currency: string;
  currencyDecimals: number;
  paymentMethod: Enums<'payment_method'>;
  paymentStatus: Enums<'payment_status'>;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  addressNotes: string | null;
  notes: string | null;
  createdAt: string;
  isMine: boolean;
  restaurant: {
    name: string;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
};

const VEHICLE_ICON: Record<string, typeof Bike> = {
  foot: Footprints,
  bike: Bike,
  moto: Truck,
  car: Car,
};

/**
 * Panel del repartidor.
 *
 * Mezcla dos listas en una: los repartos que ya lleva y los que están libres en
 * los restaurantes para los que trabaja. Como puede estar dado de alta en
 * varios locales, ve la oferta de todos ellos a la vez.
 */
export function CourierDashboard({
  courier,
  name,
  stats,
  orders,
  restaurants,
}: {
  courier: {
    id: string;
    status: Enums<'courier_status'>;
    vehicle: string;
    phone: string | null;
    city: string | null;
  };
  name: string;
  stats: { active: number; today: number; total: number; restaurants: number };
  orders: DeliveryOrder[];
  restaurants: { linkId: string; name: string; logoUrl: string | null }[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [status, setStatus] = useState(courier.status);
  const [busy, setBusy] = useState<string | null>(null);

  const mine = orders.filter((o) => o.isMine);
  const available = orders.filter((o) => !o.isMine && o.status === 'ready');

  const VehicleIcon = VEHICLE_ICON[courier.vehicle] ?? Truck;

  // Los pedidos listos aparecen sin recargar: es el momento en que hay que salir.
  const refresh = useCallback(() => router.refresh(), [router]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`courier-${courier.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [courier.id, refresh]);

  async function toggleStatus() {
    const next = status === 'offline' ? 'available' : 'offline';
    setBusy('status');
    const result = await setCourierStatus(next);
    setBusy(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setStatus(next);
  }

  async function take(order: DeliveryOrder) {
    setBusy(order.id);
    const supabase = createClient();
    const { error } = await supabase.rpc('courier_take_order', { p_order_id: order.id });
    setBusy(null);

    if (error) {
      toast(
        error.message.includes('ORDER_NOT_AVAILABLE') ? t.courier.orderTaken : t.common.error,
        'error',
      );
      router.refresh();
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  async function complete(order: DeliveryOrder) {
    setBusy(order.id);
    const supabase = createClient();
    const { error } = await supabase.rpc('courier_complete_order', { p_order_id: order.id });
    setBusy(null);

    if (error) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.order.status.completed, 'success');
    router.refresh();
  }

  const STATUS_TONE: Record<Enums<'courier_status'>, string> = {
    offline: 'bg-ink-200',
    available: 'bg-state-success',
    busy: 'bg-brand',
  };

  const STATUS_LABEL: Record<Enums<'courier_status'>, string> = {
    offline: t.courier.offline,
    available: t.courier.available,
    busy: t.courier.busy,
  };

  return (
    <div className="min-h-dvh bg-surface-soft">
      <header className="bg-ink px-5 pb-8 pt-6 text-white">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
              <VehicleIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-bold">{name}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/60">
                <span className={cn('h-2 w-2 rounded-full', STATUS_TONE[status])} />
                {STATUS_LABEL[status]}
                {courier.city && ` · ${courier.city}`}
              </p>
            </div>
            <Button
              size="sm"
              variant={status === 'offline' ? 'primary' : 'ghost'}
              loading={busy === 'status'}
              onClick={toggleStatus}
            >
              {status === 'offline' ? t.courier.goOnline : t.courier.goOffline}
            </Button>
          </div>

          <dl className="mt-6 grid grid-cols-4 gap-3">
            {[
              { label: t.courier.activeNow, value: stats.active },
              { label: t.courier.deliveredToday, value: stats.today },
              { label: t.courier.totalDeliveries, value: stats.total },
              { label: t.courier.myRestaurants, value: stats.restaurants },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/[0.08] px-3 py-3 text-center">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-white/50">
                  {stat.label}
                </dt>
                <dd className="mt-1 font-display text-xl font-bold">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-5 py-7">
        {mine.length > 0 && (
          <section>
            <h2 className="section-title mb-4">{t.courier.myDeliveries}</h2>
            <ul className="space-y-4">
              {mine.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  locale={locale}
                  busy={busy === order.id}
                  primaryLabel={t.courier.markDelivered}
                  onPrimary={() => complete(order)}
                  t={t}
                  highlighted
                />
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="section-title mb-4">{t.courier.availableOrders}</h2>

          {status === 'offline' ? (
            <EmptyState
              icon={<Package className="h-7 w-7" />}
              title={t.courier.offline}
              description={t.courier.goOnline}
              action={
                <Button loading={busy === 'status'} onClick={toggleStatus}>
                  {t.courier.goOnline}
                </Button>
              }
              className="rounded-2xl bg-white shadow-chip"
            />
          ) : available.length === 0 ? (
            <EmptyState
              icon={<Package className="h-7 w-7" />}
              title={t.courier.noAvailable}
              description={t.courier.noAvailableHint}
              className="rounded-2xl bg-white shadow-chip"
            />
          ) : (
            <ul className="space-y-4">
              {available.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  locale={locale}
                  busy={busy === order.id}
                  primaryLabel={t.courier.takeOrder}
                  onPrimary={() => take(order)}
                  t={t}
                />
              ))}
            </ul>
          )}
        </section>

        {restaurants.length > 0 && (
          <section>
            <h2 className="section-title mb-4">{t.courier.myRestaurants}</h2>
            <ul className="flex flex-wrap gap-2">
              {restaurants.map((restaurant) => (
                <li
                  key={restaurant.linkId}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink-600 shadow-chip"
                >
                  <span className="relative h-6 w-6 overflow-hidden rounded-full bg-surface-muted">
                    {restaurant.logoUrl ? (
                      <Image src={restaurant.logoUrl} alt="" fill sizes="24px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-ink-200">
                        <Store className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                  {restaurant.name}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  locale,
  busy,
  primaryLabel,
  onPrimary,
  t,
  highlighted,
}: {
  order: DeliveryOrder;
  locale: string;
  busy: boolean;
  primaryLabel: string;
  onPrimary: () => void;
  t: ReturnType<typeof useI18n>['t'];
  highlighted?: boolean;
}) {
  const elapsed = minutesSince(order.createdAt);
  const cashOnDelivery = order.paymentMethod === 'cash' && order.paymentStatus !== 'paid';

  return (
    <li
      className={cn(
        'rounded-2xl bg-white p-5 shadow-chip',
        highlighted && 'ring-2 ring-brand/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold text-ink">#{order.code}</p>
          <p className="text-xs text-ink-300">
            {formatTime(order.createdAt, locale)} ·{' '}
            {interpolate(t.kitchen.elapsed, { n: elapsed })}
          </p>
        </div>
        <span className="font-display text-lg font-bold text-ink">
          {formatMoney(order.totalCents, order.currency, order.currencyDecimals)}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-field text-ink-400">
            <Store className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-300">
              {t.courier.pickUpAt}
            </p>
            <p className="text-sm font-semibold text-ink-700">{order.restaurant.name}</p>
            {order.restaurant.address && (
              <p className="text-xs text-ink-300">{order.restaurant.address}</p>
            )}
          </div>
          {order.restaurant.phone && (
            <a
              href={`tel:${order.restaurant.phone}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-field text-ink-500"
              aria-label={order.restaurant.phone}
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>

        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-300">
              {t.courier.deliverTo}
            </p>
            <p className="text-sm font-semibold text-ink-700">{order.address ?? '—'}</p>
            {order.addressNotes && <p className="text-xs text-ink-300">{order.addressNotes}</p>}
            {order.customerName && (
              <p className="text-xs text-ink-300">{order.customerName}</p>
            )}
          </div>
          {order.customerPhone && (
            <a
              href={`tel:${order.customerPhone}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-contrast"
              aria-label={order.customerPhone}
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      {order.notes && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs italic text-amber-700">
          {order.notes}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {cashOnDelivery && (
          <Badge tone="warning">
            <Banknote className="h-3 w-3" />
            {t.checkout.cash}: {formatMoney(order.totalCents, order.currency, order.currencyDecimals)}
          </Badge>
        )}
        {order.address && (
          <Link
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.address)}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
          >
            <MapPin className="h-3.5 w-3.5" />
            Google Maps
          </Link>
        )}
      </div>

      <Button className="mt-4 w-full" loading={busy} onClick={onPrimary}>
        <CheckCircle2 className="h-4 w-4" />
        {primaryLabel}
      </Button>
    </li>
  );
}
