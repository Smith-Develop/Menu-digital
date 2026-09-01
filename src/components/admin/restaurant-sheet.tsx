'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  ExternalLink,
  KeyRound,
  Mail,
  Pause,
  Play,
  QrCode,
  Receipt,
  Store,
  UsersRound,
  UtensilsCrossed,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import {
  assignPlan,
  extendSubscription,
  setRestaurantActive,
  changeOwnerEmail,
  sendPasswordReset,
} from '@/app/admin/actions';
import { formatMoney } from '@/lib/money';
import { formatDate, cn } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import type { Enums } from '@/types/database';

type Props = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    coverUrl: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    currency: string;
    currencyDecimals: number;
    isActive: boolean;
    isOpen: boolean;
    createdAt: string;
  };
  owner: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  subscription: {
    id: string;
    planId: string | null;
    planName: string | null;
    status: Enums<'subscription_status'>;
    periodEnd: string;
    daysLeft: number;
    isLive: boolean;
  } | null;
  plans: { id: string; name: string; interval: Enums<'plan_interval'>; priceCents: number; currency: string }[];
  counts: { products: number; tables: number; orders: number; staff: number };
  payments: { id: string; amountCents: number; currency: string; status: Enums<'payment_status'>; createdAt: string }[];
};

/**
 * Ficha completa de un restaurante para el superadministrador: datos, cuenta
 * del titular, suscripción y actividad, con las acciones de gestión a mano.
 */
export function RestaurantSheet({
  restaurant,
  owner,
  subscription,
  plans,
  counts,
  payments,
}: Props) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [emailSheet, setEmailSheet] = useState(false);
  const [planSheet, setPlanSheet] = useState(false);
  const [newEmail, setNewEmail] = useState(owner?.email ?? '');
  const [planId, setPlanId] = useState(subscription?.planId ?? '');

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    setBusy(key);
    const result = await fn();
    setBusy(null);

    if (!result.ok) {
      toast(result.error === 'EMAIL_TAKEN' ? t.admin.emailTaken : t.common.error, 'error');
      return false;
    }
    toast(successMessage, 'success');
    router.refresh();
    return true;
  }

  return (
    <>
      <Link href="/admin/restaurants" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-400 hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        {t.admin.restaurants}
      </Link>

      {/* Cabecera */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-chip">
        <div className="relative h-32 bg-surface-muted">
          {restaurant.coverUrl && (
            <Image src={restaurant.coverUrl} alt="" fill sizes="900px" className="object-cover" />
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4 px-6 pb-5">
          <span className="relative -mt-10 h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-surface-muted">
            {restaurant.logoUrl ? (
              <Image src={restaurant.logoUrl} alt="" fill sizes="80px" className="object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-ink-300">
                <Store className="h-7 w-7" />
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1 pt-3">
            <h1 className="font-display text-2xl font-bold text-ink">{restaurant.name}</h1>
            <p className="mt-0.5 text-sm text-ink-300">
              /r/{restaurant.slug}
              {restaurant.city && ` · ${restaurant.city}`}
              {` · ${t.admin.since} ${formatDate(restaurant.createdAt, locale)}`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-3">
            {!restaurant.isActive && <Badge tone="danger">{t.common.inactive}</Badge>}
            <Link href={`/r/${restaurant.slug}`} target="_blank" className="btn-ghost text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              {t.storefront.viewMenu}
            </Link>
            <button
              type="button"
              onClick={() =>
                run(
                  'active',
                  () => setRestaurantActive(restaurant.id, !restaurant.isActive),
                  t.common.save,
                )
              }
              disabled={busy === 'active'}
              // Las dos caras del interruptor con superficie propia: suspender
              // sin fondo se leía como texto, no como botón.
              className={cn(
                'btn text-xs',
                restaurant.isActive
                  ? 'bg-red-50 text-state-danger hover:bg-red-100'
                  : 'bg-state-success text-white hover:brightness-95',
              )}
            >
              {restaurant.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {restaurant.isActive ? t.admin.suspend : t.admin.activate}
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Count icon={<UtensilsCrossed className="h-4 w-4" />} label={t.dashboard.products} value={counts.products} />
        <Count icon={<QrCode className="h-4 w-4" />} label={t.dashboard.tables} value={counts.tables} />
        <Count icon={<UsersRound className="h-4 w-4" />} label={t.dashboard.staff} value={counts.staff} />
        <Count icon={<Receipt className="h-4 w-4" />} label={t.analytics.ordersShort} value={counts.orders} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Cuenta del titular */}
        <section className="rounded-2xl bg-white p-6 shadow-chip">
          <h2 className="mb-4 font-display text-base font-bold text-ink-700">{t.admin.ownerAccount}</h2>

          {owner ? (
            <>
              <dl className="space-y-2 text-sm">
                <Row label={t.auth.fullName} value={owner.name ?? '—'} />
                <Row label={t.auth.email} value={owner.email ?? '—'} mono />
                <Row label={t.auth.phone} value={owner.phone ?? '—'} />
              </dl>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setEmailSheet(true)}>
                  <Mail className="h-4 w-4" />
                  {t.admin.changeEmail}
                </Button>
                <Button
                  variant="ghost"
                  loading={busy === 'reset'}
                  onClick={() =>
                    owner.email &&
                    run('reset', () => sendPasswordReset(owner.email!), `${t.auth.resetSentTo} ${owner.email}`)
                  }
                >
                  <KeyRound className="h-4 w-4" />
                  {t.auth.sendReset}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-300">{t.admin.noOwner}</p>
          )}
        </section>

        {/* Suscripción */}
        <section className="rounded-2xl bg-white p-6 shadow-chip">
          <h2 className="mb-4 font-display text-base font-bold text-ink-700">{t.dashboard.subscription}</h2>

          {subscription ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold text-ink">
                  {subscription.planName ?? t.subscription.noPlan}
                </span>
                <Badge tone={subscription.isLive ? 'success' : 'danger'}>
                  {subscription.isLive ? t.common.active : t.admin.expired}
                </Badge>
              </div>

              <p className="mt-2 text-sm text-ink-400">
                {t.admin.expiresOn} {formatDate(subscription.periodEnd, locale)}
                {subscription.daysLeft > 0 &&
                  ` · ${interpolate(t.admin.daysLeft, { n: subscription.daysLeft })}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-300">{t.subscription.noPlan}</p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setPlanSheet(true)}>{t.admin.assignPlan}</Button>
            {subscription && (
              <>
                <Button
                  variant="ghost"
                  loading={busy === 'ext30'}
                  onClick={() => run('ext30', () => extendSubscription(subscription.id, 30), t.common.save)}
                >
                  <CalendarPlus className="h-4 w-4" />
                  30 d
                </Button>
                <Button
                  variant="ghost"
                  loading={busy === 'ext365'}
                  onClick={() => run('ext365', () => extendSubscription(subscription.id, 365), t.common.save)}
                >
                  <CalendarPlus className="h-4 w-4" />
                  1 año
                </Button>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Pagos */}
      <section className="rounded-2xl bg-white p-6 shadow-chip">
        <h2 className="mb-4 font-display text-base font-bold text-ink-700">{t.subscription.invoices}</h2>
        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-300">{t.common.empty}</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm text-ink-400">{formatDate(payment.createdAt, locale)}</span>
                <span className="flex items-center gap-3">
                  <Badge tone={payment.status === 'paid' ? 'success' : 'warning'}>
                    {t.order.payment[payment.status]}
                  </Badge>
                  <span className="text-sm font-bold text-ink">
                    {formatMoney(payment.amountCents, payment.currency)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cambio de correo */}
      <Sheet
        open={emailSheet}
        onClose={() => setEmailSheet(false)}
        title={t.admin.changeEmail}
        footer={
          <Button
            size="block"
            loading={busy === 'email'}
            disabled={!newEmail.trim() || newEmail === owner?.email}
            onClick={async () => {
              if (!owner) return;
              const ok = await run('email', () => changeOwnerEmail(owner.id, newEmail), t.common.save);
              if (ok) setEmailSheet(false);
            }}
          >
            {t.common.save}
          </Button>
        }
      >
        <Input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          label={t.auth.email}
          hint={t.admin.changeEmailHint}
        />
      </Sheet>

      {/* Asignar plan */}
      <Sheet
        open={planSheet}
        onClose={() => setPlanSheet(false)}
        title={t.admin.assignPlan}
        footer={
          <Button
            size="block"
            loading={busy === 'plan'}
            disabled={!planId}
            onClick={async () => {
              const ok = await run('plan', () => assignPlan(restaurant.id, planId), t.common.save);
              if (ok) setPlanSheet(false);
            }}
          >
            {t.common.confirm}
          </Button>
        }
      >
        <Select value={planId} onChange={(e) => setPlanId(e.target.value)} label={t.admin.plans}>
          <option value="">—</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} · {formatMoney(plan.priceCents, plan.currency)} /
              {plan.interval === 'month' ? t.admin.monthly : t.admin.yearly}
            </option>
          ))}
        </Select>
        <p className="mt-3 text-xs text-ink-300">{t.admin.assignPlanHint}</p>
      </Sheet>
    </>
  );
}

function Count({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-chip">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-300">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-ink-400">{label}</dt>
      <dd className={cn('min-w-0 truncate font-semibold text-ink-700', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  );
}
