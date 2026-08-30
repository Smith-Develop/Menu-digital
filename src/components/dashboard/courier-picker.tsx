'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Bike, Car, Check, Footprints, Loader2, Package, Truck, UserRound } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Badge } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/i18n/provider';
import { cn, initials } from '@/lib/utils';
import type { Enums } from '@/types/database';

type CourierOption = {
  courier_id: string;
  name: string;
  avatar_url: string | null;
  phone: string | null;
  vehicle: string;
  status: Enums<'courier_status'>;
  active_here: number;
  active_total: number;
  deliveries: number;
  rating: number;
};

const VEHICLE_ICON: Record<string, typeof Bike> = {
  foot: Footprints,
  bike: Bike,
  moto: Truck,
  car: Car,
};

/**
 * Elección de repartidor para un pedido.
 *
 * La carga que se muestra cuenta los repartos de todos los restaurantes para
 * los que trabaja, no solo los de este: un repartidor con tres entregas de otro
 * local no está libre por mucho que aquí no tenga ninguna.
 */
export function CourierPicker({
  open,
  onClose,
  restaurantId,
  orderId,
  orderCode,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  orderId: string | null;
  orderCode: string | null;
  onAssigned: () => void;
}) {
  const t = useT();
  const toast = useToast();

  const [couriers, setCouriers] = useState<CourierOption[] | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCouriers(null);
      return;
    }

    let active = true;
    const supabase = createClient();
    supabase
      .rpc('restaurant_couriers_available', { p_restaurant_id: restaurantId })
      .then(({ data }) => {
        if (active) setCouriers((data as CourierOption[] | null) ?? []);
      });

    return () => {
      active = false;
    };
  }, [open, restaurantId]);

  async function assign(courierId: string) {
    if (!orderId) return;
    setAssigning(courierId);

    const supabase = createClient();
    const { error } = await supabase.rpc('assign_order_courier', {
      p_order_id: orderId,
      p_courier_id: courierId,
    });
    setAssigning(null);

    if (error) {
      toast(
        error.message.includes('COURIER_NOT_IN_TEAM') ? t.courier.notInTeam : t.common.error,
        'error',
      );
      return;
    }
    toast(t.courier.assigned, 'success');
    onAssigned();
    onClose();
  }

  const STATUS: Record<Enums<'courier_status'>, { label: string; tone: 'success' | 'brand' | 'neutral' }> = {
    available: { label: t.courier.available, tone: 'success' },
    busy: { label: t.courier.busy, tone: 'brand' },
    offline: { label: t.courier.offline, tone: 'neutral' },
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${t.courier.assignTo} ${orderCode ? `#${orderCode}` : ''}`}
      size="md"
    >
      {couriers === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        </div>
      ) : couriers.length === 0 ? (
        <EmptyState
          icon={<UserRound className="h-7 w-7" />}
          title={t.courier.noCouriers}
          description={t.courier.noCouriersHint}
        />
      ) : (
        <ul className="stagger space-y-2">
          {couriers.map((courier) => {
            const VehicleIcon = VEHICLE_ICON[courier.vehicle] ?? Truck;
            const busy = assigning === courier.courier_id;
            const otherLoad = courier.active_total - courier.active_here;

            return (
              <li key={courier.courier_id}>
                <button
                  type="button"
                  onClick={() => assign(courier.courier_id)}
                  disabled={assigning !== null}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border-2 border-transparent bg-surface-field p-3 text-left transition-colors',
                    'hover:border-brand/40 hover:bg-brand-50 disabled:opacity-60',
                  )}
                >
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white">
                    {courier.avatar_url ? (
                      <Image src={courier.avatar_url} alt="" fill sizes="48px" className="object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-sm font-bold text-brand-700">
                        {initials(courier.name)}
                      </span>
                    )}
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-surface-field',
                        courier.status === 'available'
                          ? 'bg-state-success'
                          : courier.status === 'busy'
                            ? 'bg-brand'
                            : 'bg-ink-200',
                      )}
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink-700">
                      {courier.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-300">
                      <span className="inline-flex items-center gap-1">
                        <VehicleIcon className="h-3.5 w-3.5" />
                        {t.courier[courier.vehicle as 'moto'] ?? courier.vehicle}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        {courier.active_total} {t.courier.inProgress}
                      </span>
                      {otherLoad > 0 && (
                        <span className="text-amber-600">
                          {otherLoad} {t.courier.fromOtherRestaurants}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS[courier.status].tone}>{STATUS[courier.status].label}</Badge>
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-brand" />
                    ) : (
                      <Check className="h-4 w-4 text-ink-200" />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
