'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Box, Check, CreditCard, Receipt } from 'lucide-react';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { useI18n, interpolate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

type Plan = {
  id: string;
  name: string;
  description: string | null;
  interval: Enums<'plan_interval'>;
  priceCents: number;
  currency: string;
  trialDays: number;
  maxTables: number | null;
  maxProducts: number | null;
  maxStaff: number | null;
  allows3d: boolean;
  features: string[];
};

type Current = {
  status: Enums<'subscription_status'>;
  periodEnd: string;
  daysLeft: number;
  isLive: boolean;
  planId: string | null;
  planName: string | null;
};

type Payment = {
  id: string;
  amountCents: number;
  currency: string;
  status: Enums<'payment_status'>;
  createdAt: string;
  paidAt: string | null;
};

export function SubscriptionView({
  stripeEnabled,
  paymentResult,
  current,
  plans,
  payments,
}: {
  stripeEnabled: boolean;
  paymentResult: 'success' | 'cancelled' | null;
  current: Current | null;
  plans: Plan[];
  payments: Payment[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [interval, setInterval] = useState<Enums<'plan_interval'>>('month');

  useEffect(() => {
    if (paymentResult === 'success') toast(t.subscription.paymentSuccess, 'success');
    if (paymentResult === 'cancelled') toast(t.subscription.paymentCancelled, 'info');
  }, [paymentResult, toast, t]);

  async function checkout(planId: string) {
    if (!stripeEnabled) {
      toast(t.subscription.stripeNotConfigured, 'error');
      return;
    }

    setLoadingPlan(planId);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        toast(
          data.error === 'STRIPE_NOT_CONFIGURED' ? t.subscription.stripeNotConfigured : t.common.error,
          'error',
        );
        return;
      }
      window.location.href = data.url;
    } catch {
      toast(t.common.error, 'error');
    } finally {
      setLoadingPlan(null);
    }
  }

  const visiblePlans = plans.filter((plan) => plan.interval === interval);

  return (
    <div className="space-y-7">
      {/* Estado actual */}
      <section
        className={cn(
          'rounded-2xl p-6',
          current?.isLive ? 'bg-ink text-white' : 'bg-red-50 text-red-800',
        )}
      >
        {current ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p
                  className={cn(
                    'text-xs font-bold uppercase tracking-[0.1em]',
                    current.isLive ? 'text-white/60' : 'text-red-500',
                  )}
                >
                  {t.subscription.currentPlan}
                </p>
                <p className="mt-1 font-display text-2xl font-bold">
                  {current.planName ?? t.subscription.noPlan}
                </p>
              </div>
              <Badge tone={current.isLive ? 'success' : 'danger'}>
                {current.isLive ? t.common.active : t.admin.expired}
              </Badge>
            </div>

            <p className={cn('mt-4 text-sm', current.isLive ? 'text-white/70' : '')}>
              {t.admin.expiresOn} {formatDate(current.periodEnd, locale)}
              {current.daysLeft > 0 && ` · ${interpolate(t.admin.daysLeft, { n: current.daysLeft })}`}
            </p>

            {!current.isLive && (
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" />
                {t.subscription.expiredWarning}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-display text-xl font-bold">{t.subscription.noPlan}</p>
            <p className="mt-2 text-sm text-red-700">{t.subscription.contactAdmin}</p>
          </>
        )}
      </section>

      {!stripeEnabled && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {t.subscription.stripeNotConfigured}. Añade <code className="font-mono">STRIPE_SECRET_KEY</code>{' '}
            y <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> al entorno para habilitar la
            renovación con tarjeta.
          </p>
        </div>
      )}

      {/* Planes */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-bold text-ink-700">{t.subscription.changePlan}</h2>
          <div className="flex gap-1 rounded-xl bg-surface-field p-1">
            {(['month', 'year'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setInterval(key)}
                className={cn(
                  'rounded-lg px-4 py-2 text-xs font-bold transition-colors',
                  interval === key ? 'bg-white text-ink shadow-sm' : 'text-ink-400',
                )}
              >
                {key === 'month' ? t.admin.monthly : t.admin.yearly}
              </button>
            ))}
          </div>
        </div>

        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiblePlans.map((plan) => {
            const isCurrent = current?.planId === plan.id;
            return (
              <li
                key={plan.id}
                className={cn(
                  'flex flex-col rounded-2xl bg-white p-6 shadow-chip',
                  isCurrent && 'ring-2 ring-brand',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-lg font-bold text-ink">{plan.name}</h3>
                  {isCurrent && <Badge tone="brand">{t.subscription.currentPlan}</Badge>}
                </div>

                <p className="mt-3 font-display text-3xl font-bold text-ink">
                  {formatMoney(plan.priceCents, plan.currency)}
                  <span className="ml-1 text-sm font-normal text-ink-300">
                    /{plan.interval === 'month' ? 'mes' : 'año'}
                  </span>
                </p>

                {plan.description && (
                  <p className="mt-2 text-sm text-ink-300">{plan.description}</p>
                )}

                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  <LimitRow label={t.admin.maxTables} value={plan.maxTables} unlimited={t.admin.unlimited} />
                  <LimitRow label={t.admin.maxProducts} value={plan.maxProducts} unlimited={t.admin.unlimited} />
                  <LimitRow label={t.admin.maxStaff} value={plan.maxStaff} unlimited={t.admin.unlimited} />
                  {plan.allows3d && (
                    <li className="flex items-center gap-2 text-ink-600">
                      <Box className="h-4 w-4 shrink-0 text-brand" />
                      {t.dashboard.model3d}
                    </li>
                  )}
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-ink-600">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-state-success" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  className="mt-6 w-full"
                  variant={isCurrent ? 'ghost' : 'primary'}
                  loading={loadingPlan === plan.id}
                  disabled={!stripeEnabled}
                  onClick={() => checkout(plan.id)}
                >
                  <CreditCard className="h-4 w-4" />
                  {isCurrent ? t.subscription.renewNow : t.subscription.payWithStripe}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Facturas */}
      <section>
        <h2 className="mb-4 font-display text-lg font-bold text-ink-700">{t.subscription.invoices}</h2>
        {payments.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-7 w-7" />}
            title={t.common.empty}
            className="rounded-2xl bg-white shadow-chip"
          />
        ) : (
          <ul className="divide-y divide-surface-line rounded-2xl bg-white shadow-chip">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-bold text-ink-700">
                    {formatMoney(payment.amountCents, payment.currency)}
                  </p>
                  <p className="text-xs text-ink-300">
                    {formatDate(payment.paidAt ?? payment.createdAt, locale)}
                  </p>
                </div>
                <Badge tone={payment.status === 'paid' ? 'success' : 'warning'}>
                  {t.order.payment[payment.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LimitRow({
  label,
  value,
  unlimited,
}: {
  label: string;
  value: number | null;
  unlimited: string;
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-ink-500">
      <span>{label}</span>
      <span className="font-bold text-ink-700">{value ?? unlimited}</span>
    </li>
  );
}
