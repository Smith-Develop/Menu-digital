'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CalendarPlus, ExternalLink, Store, UserPlus } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import {
  assignPlan,
  extendSubscription,
  setRestaurantActive,
  addStaffByEmail,
} from '@/app/admin/actions';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import { STAFF_ROLES, staffRoleLabel } from '@/lib/staff-roles';
import type { Enums } from '@/types/database';

type PlanOption = {
  id: string;
  name: string;
  interval: Enums<'plan_interval'>;
  priceCents: number;
  currency: string;
};

type Row = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  ownerName: string | null;
  subscription: {
    id: string;
    planId: string | null;
    planName: string | null;
    status: Enums<'subscription_status'>;
    periodEnd: string;
    daysLeft: number;
    isLive: boolean;
  } | null;
};

export function RestaurantsTable({ plans, restaurants }: { plans: PlanOption[]; restaurants: Row[] }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [assignFor, setAssignFor] = useState<Row | null>(null);
  const [staffFor, setStaffFor] = useState<Row | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState<Enums<'staff_role'>>('waiter');
  const [saving, setSaving] = useState(false);

  async function doAssign() {
    if (!assignFor || !selectedPlan) return;
    setSaving(true);
    const result = await assignPlan(assignFor.id, selectedPlan);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setAssignFor(null);
    setSelectedPlan('');
    router.refresh();
  }

  async function extend(row: Row, days: number) {
    if (!row.subscription) return;
    const result = await extendSubscription(row.subscription.id, days);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  async function toggleActive(row: Row) {
    const result = await setRestaurantActive(row.id, !row.isActive);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    router.refresh();
  }

  async function addStaff() {
    if (!staffFor || !staffEmail.trim()) return;
    setSaving(true);
    const result = await addStaffByEmail(staffFor.id, staffEmail, staffRole);
    setSaving(false);

    if (!result.ok) {
      toast(result.error === 'USER_NOT_FOUND' ? 'No existe ninguna cuenta con ese correo' : t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setStaffFor(null);
    setStaffEmail('');
    router.refresh();
  }

  if (restaurants.length === 0) {
    return (
      <EmptyState
        icon={<Store className="h-7 w-7" />}
        title={t.storefront.noRestaurants}
        className="rounded-2xl bg-white shadow-chip"
      />
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {restaurants.map((row) => (
          <li key={row.id} className="rounded-2xl bg-white p-5 shadow-chip">
            <div className="flex flex-wrap items-start gap-4">
              <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                {row.logoUrl ? (
                  <Image src={row.logoUrl} alt={row.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-200">
                    <Store className="h-5 w-5" />
                  </span>
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-display text-base font-bold text-ink-700">{row.name}</p>
                  {!row.isActive && <Badge tone="danger">{t.common.inactive}</Badge>}
                  {row.subscription ? (
                    <Badge tone={row.subscription.isLive ? 'success' : 'danger'}>
                      {row.subscription.planName ?? '—'}
                    </Badge>
                  ) : (
                    <Badge tone="warning">{t.subscription.noPlan}</Badge>
                  )}
                </div>

                <p className="mt-0.5 truncate text-xs text-ink-300">
                  /r/{row.slug}
                  {row.city && ` · ${row.city}`}
                  {row.ownerName && ` · ${row.ownerName}`}
                </p>

                {row.subscription && (
                  <p className="mt-1.5 text-xs text-ink-400">
                    {t.admin.expiresOn} {formatDate(row.subscription.periodEnd, locale)}
                    {' · '}
                    <span
                      className={
                        row.subscription.daysLeft <= 0
                          ? 'font-bold text-state-danger'
                          : row.subscription.daysLeft <= 7
                            ? 'font-bold text-amber-600'
                            : ''
                      }
                    >
                      {row.subscription.daysLeft <= 0
                        ? t.admin.expired
                        : interpolate(t.admin.daysLeft, { n: row.subscription.daysLeft })}
                    </span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/r/${row.slug}`}
                  target="_blank"
                  className="btn-ghost text-xs"
                  title={t.storefront.viewMenu}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => setStaffFor(row)}
                  className="btn-ghost text-xs"
                  title={t.dashboard.inviteStaff}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </button>
                {row.subscription && (
                  <button
                    type="button"
                    onClick={() => extend(row, 30)}
                    className="btn-ghost text-xs"
                    title="+30 días"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    30 d
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAssignFor(row)}
                  className="btn-primary text-xs"
                >
                  {t.admin.assignPlan}
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(row)}
                  className="btn-ghost text-xs"
                >
                  {row.isActive ? t.admin.suspend : t.admin.activate}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={assignFor !== null}
        onClose={() => setAssignFor(null)}
        title={`${t.admin.assignPlan} · ${assignFor?.name ?? ''}`}
        footer={
          <Button size="block" loading={saving} onClick={doAssign} disabled={!selectedPlan}>
            {t.common.confirm}
          </Button>
        }
      >
        <Select
          value={selectedPlan}
          onChange={(e) => setSelectedPlan(e.target.value)}
          label={t.admin.plans}
        >
          <option value="">—</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} · {formatMoney(plan.priceCents, plan.currency)} /
              {plan.interval === 'month' ? t.admin.monthly : t.admin.yearly}
            </option>
          ))}
        </Select>
        <p className="mt-3 text-xs text-ink-300">
          Al asignar un plan se cierra la suscripción anterior y se abre un periodo nuevo desde hoy.
        </p>
      </Sheet>

      <Sheet
        open={staffFor !== null}
        onClose={() => setStaffFor(null)}
        title={`${t.dashboard.inviteStaff} · ${staffFor?.name ?? ''}`}
        footer={
          <Button size="block" loading={saving} onClick={addStaff} disabled={!staffEmail.trim()}>
            {t.common.add}
          </Button>
        }
      >
        <div className="space-y-4">
          <Input
            type="email"
            value={staffEmail}
            onChange={(e) => setStaffEmail(e.target.value)}
            label={t.auth.email}
            placeholder="cocina@restaurante.com"
            hint="La persona debe haberse registrado antes en /register."
          />
          <Select
            value={staffRole}
            onChange={(e) => setStaffRole(e.target.value as Enums<'staff_role'>)}
            label="Rol"
          >
            {STAFF_ROLES.filter((role) => role !== 'owner').map((role) => (
              <option key={role} value={role}>
                {staffRoleLabel(role, t)}
              </option>
            ))}
          </Select>
        </div>
      </Sheet>
    </>
  );
}
