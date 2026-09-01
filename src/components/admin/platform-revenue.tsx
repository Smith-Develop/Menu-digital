'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bike, Check, Percent, Store, TrendingUp, Wallet } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { settlePlatformCommissions } from '@/app/admin/actions';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n/provider';

export type PlatformRevenue = {
  fees_cents: number;
  fees_count: number;
  commission_cents: number;
  commission_base_cents: number;
  commission_restaurants_cents: number;
  commission_couriers_cents: number;
  sponsorship_cents: number;
  sponsorship_count: number;
  sponsorships_reserved: {
    id: string;
    name: string;
    kind: string;
    city: string | null;
    starts_on: string;
    ends_on: string;
    days: number;
    cents: number;
  }[];
  pending_cents: number;
  active_subscriptions: number;
  paying_restaurants: number;
  paying_couriers: number;
  top_restaurants: { id: string; name: string; cents: number; base_cents: number }[];
  pending_by_subject: {
    subject_type: 'restaurant' | 'courier';
    subject_id: string;
    name: string;
    lines: number;
    cents: number;
  }[];
};

function Tile({
  icon,
  label,
  value,
  hint,
  tone = 'ink',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: 'ink' | 'brand' | 'money';
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-chip">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl',
            tone === 'brand'
              ? 'bg-brand-50 text-brand-700'
              : tone === 'money'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-surface-field text-ink-500',
          )}
        >
          {icon}
        </span>
        <p className="text-xs font-bold uppercase tracking-wide text-ink-300">{label}</p>
      </div>
      <p className="mt-4 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-300">{hint}</p>}
    </div>
  );
}

/**
 * Lo que gana la plataforma.
 *
 * La analítica que había mide lo que venden los locales; esto mide la otra
 * mitad, que no estaba en ningún sitio. Las dos fuentes van separadas —cuota y
 * comisión— porque son decisiones distintas: la cuota se renegocia, la comisión
 * sube sola con las ventas.
 */
export function PlatformRevenuePanel({
  data,
  currency,
}: {
  data: PlatformRevenue;
  currency: string;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [liquidar, setLiquidar] = useState<PlatformRevenue['pending_by_subject'][number] | null>(null);
  const [guardando, setGuardando] = useState(false);

  const money = (c: number) => formatMoney(c, currency);
  // Las tres vías juntas: la cuota, la comisión y lo que se vende en la
  // portada. Separadas debajo, porque son decisiones distintas.
  const total = data.fees_cents + data.commission_cents + data.sponsorship_cents;

  async function confirmar() {
    if (!liquidar) return;
    setGuardando(true);
    const result = await settlePlatformCommissions(liquidar.subject_type, liquidar.subject_id);
    setGuardando(false);
    setLiquidar(null);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(`${t.admin.settled}: ${money(result.data.amountCents)}`, 'success');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={<TrendingUp className="h-5 w-5" />}
          label={t.admin.platformIncome}
          value={money(total)}
          hint={`${t.admin.fees} ${money(data.fees_cents)} · ${t.admin.commissions} ${money(data.commission_cents)} · ${t.sponsor.income} ${money(data.sponsorship_cents)}`}
          tone="money"
        />
        <Tile
          icon={<Percent className="h-5 w-5" />}
          label={t.admin.commissions}
          value={money(data.commission_cents)}
          hint={`${t.admin.over} ${money(data.commission_base_cents)}`}
          tone="brand"
        />
        <Tile
          icon={<Wallet className="h-5 w-5" />}
          label={t.admin.pendingSettlement}
          value={money(data.pending_cents)}
          hint={`${data.pending_by_subject.length} ${t.admin.subjects}`}
        />
        <Tile
          icon={<Store className="h-5 w-5" />}
          label={t.admin.paying}
          value={String(data.active_subscriptions)}
          hint={`${data.paying_restaurants} ${t.admin.businesses} · ${data.paying_couriers} ${t.admin.couriers}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <h2 className="mb-1 font-display text-base font-bold text-ink-700">
            {t.admin.pendingSettlement}
          </h2>
          <p className="mb-3 text-xs text-ink-300">{t.admin.pendingHint}</p>

          {data.pending_by_subject.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-300">{t.admin.nothingPending}</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {data.pending_by_subject.map((row) => (
                <li key={`${row.subject_type}:${row.subject_id}`} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-field text-ink-400">
                    {row.subject_type === 'courier' ? (
                      <Bike className="h-4 w-4" />
                    ) : (
                      <Store className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-700">
                      {row.name}
                    </span>
                    <span className="block text-xs text-ink-300">
                      {row.lines} {t.admin.lines}
                    </span>
                  </span>
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                    {money(row.cents)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLiquidar(row)}
                    className="btn-soft shrink-0 px-3 py-1.5 text-xs"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t.admin.settle}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-chip">
          <h2 className="mb-3 font-display text-base font-bold text-ink-700">
            {t.admin.topByCommission}
          </h2>
          {data.top_restaurants.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-300">{t.analytics.noData}</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {data.top_restaurants.map((r) => (
                <li key={r.id} className="flex items-baseline gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-700">
                    {r.name}
                  </span>
                  <span className="shrink-0 text-xs text-ink-300">{money(r.base_cents)}</span>
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                    {money(r.cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={liquidar !== null}
        onClose={() => setLiquidar(null)}
        onConfirm={confirmar}
        title={t.admin.settle}
        message={
          liquidar
            ? `${liquidar.name} · ${money(liquidar.cents)} ${t.admin.inLines.replace('{n}', String(liquidar.lines))}`
            : ''
        }
        confirmLabel={t.admin.settle}
        cancelLabel={t.common.cancel}
        loading={guardando}
      />
    </div>
  );
}
