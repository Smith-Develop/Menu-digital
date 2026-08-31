'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bike, Car, Footprints, Plus, Trash2, Truck, UserRound } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { addCourierToRestaurant, removeCourierFromRestaurant } from '@/app/courier/actions';
import { useT } from '@/i18n/provider';
import { initials, cn } from '@/lib/utils';
import { CourierSheet } from '@/components/dashboard/courier-sheet';
import type { Enums } from '@/types/database';

type Member = {
  linkId: string;
  courierId: string;
  name: string;
  email: string | null;
  phone: string | null;
  vehicle: string;
  status: Enums<'courier_status'>;
  deliveries: number;
  isActive: boolean;
};

const VEHICLE_ICON: Record<string, typeof Bike> = {
  foot: Footprints,
  bike: Bike,
  moto: Truck,
  car: Car,
};

export function CouriersManager({
  members,
  currency,
  currencyDecimals,
}: {
  members: Member[];
  currency: string;
  currencyDecimals: number;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ficha, setFicha] = useState<Member | null>(null);

  async function add() {
    if (!email.trim()) return;
    setSaving(true);
    const result = await addCourierToRestaurant(email);
    setSaving(false);

    if (!result.ok) {
      toast(
        result.error === 'COURIER_NOT_FOUND'
          ? t.courier.courierNotFound
          : result.error === 'ALREADY_LINKED'
            ? t.courier.alreadyLinked
            : t.common.error,
        'error',
      );
      return;
    }
    toast(t.common.save, 'success');
    setAdding(false);
    setEmail('');
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await removeCourierFromRestaurant(confirmId);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  const STATUS_LABEL: Record<Enums<'courier_status'>, string> = {
    offline: t.courier.offline,
    available: t.courier.available,
    busy: t.courier.busy,
  };

  const VEHICLE_LABEL: Record<string, string> = {
    foot: t.courier.foot,
    bike: t.courier.bike,
    moto: t.courier.moto,
    car: t.courier.car,
  };

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          {t.courier.addCourier}
        </Button>
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={<UserRound className="h-7 w-7" />}
          title={t.courier.noCouriers}
          description={t.courier.noCouriersHint}
          className="rounded-2xl bg-white shadow-chip"
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              {t.courier.addCourier}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {members.map((member) => {
            const Icon = VEHICLE_ICON[member.vehicle] ?? Truck;
            return (
              <li
                key={member.linkId}
                className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-4 shadow-chip"
              >
                <button
                  type="button"
                  onClick={() => setFicha(member)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                    {initials(member.name)}
                  </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink-700">{member.name}</p>
                  <p className="truncate text-xs text-ink-300">
                    {member.email}
                    {member.phone && ` · ${member.phone}`}
                  </p>
                </div>
                </button>

                <span className="inline-flex items-center gap-1.5 text-xs text-ink-400">
                  <Icon className="h-4 w-4" />
                  {VEHICLE_LABEL[member.vehicle] ?? member.vehicle}
                </span>

                <span className="text-xs text-ink-300">
                  {member.deliveries} {t.courier.deliveries}
                </span>

                <Badge
                  tone={
                    member.status === 'available'
                      ? 'success'
                      : member.status === 'busy'
                        ? 'brand'
                        : 'neutral'
                  }
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      member.status === 'available'
                        ? 'bg-emerald-600'
                        : member.status === 'busy'
                          ? 'bg-brand'
                          : 'bg-ink-200',
                    )}
                  />
                  {STATUS_LABEL[member.status]}
                </Badge>

                <button
                  type="button"
                  onClick={() => setConfirmId(member.linkId)}
                  aria-label={t.courier.removeCourier}
                  title={t.courier.removeCourier}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title={t.courier.addCourier}
        footer={
          <Button size="block" loading={saving} onClick={add} disabled={!email.trim()}>
            {t.common.add}
          </Button>
        }
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={t.auth.email}
          placeholder="repartidor@correo.com"
          hint={t.courier.addCourierHint}
        />
      </Sheet>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={remove}
        title={t.courier.removeCourier}
        message={t.common.confirm}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
      <CourierSheet
        courier={
          ficha
            ? {
                courierId: ficha.courierId,
                name: ficha.name,
                email: ficha.email,
                phone: ficha.phone,
                vehicle: ficha.vehicle,
                status: ficha.status,
                deliveries: ficha.deliveries,
              }
            : null
        }
        onClose={() => setFicha(null)}
        currency={currency}
        currencyDecimals={currencyDecimals}
      />

    </>
  );
}
