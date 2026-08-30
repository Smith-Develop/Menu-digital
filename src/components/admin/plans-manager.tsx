'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Box, Check, Package, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { savePlan, deletePlan } from '@/app/admin/actions';
import { CURRENCIES, formatAmount, parseAmount, formatMoney, getCurrency } from '@/lib/money';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type PlanRow = {
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
  allowsDelivery: boolean;
  features: string[];
  stripePriceId: string | null;
  isActive: boolean;
  position: number;
  subscribers: number;
};

type Draft = Omit<PlanRow, 'id' | 'subscribers'> & { id?: string };

function emptyDraft(position: number): Draft {
  return {
    name: '',
    description: '',
    interval: 'month',
    priceCents: 0,
    currency: 'EUR',
    trialDays: 0,
    maxTables: null,
    maxProducts: null,
    maxStaff: null,
    allows3d: true,
    allowsDelivery: true,
    features: [],
    stripePriceId: null,
    isActive: true,
    position,
  };
}

export function PlansManager({ plans }: { plans: PlanRow[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [featureDraft, setFeatureDraft] = useState('');

  const decimals = draft ? getCurrency(draft.currency).decimals : 2;

  async function submit() {
    if (!draft?.name.trim()) {
      toast(t.common.required, 'error');
      return;
    }
    setSaving(true);

    const result = await savePlan({
      id: draft.id,
      name: draft.name,
      description: draft.description || null,
      interval: draft.interval,
      price_cents: draft.priceCents,
      currency: draft.currency,
      trial_days: draft.trialDays,
      max_tables: draft.maxTables,
      max_products: draft.maxProducts,
      max_staff: draft.maxStaff,
      allows_3d: draft.allows3d,
      allows_delivery: draft.allowsDelivery,
      features: draft.features,
      stripe_price_id: draft.stripePriceId || null,
      is_active: draft.isActive,
      position: draft.position,
    });

    setSaving(false);
    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deletePlan(confirmId);
    setSaving(false);

    if (!result.ok) {
      toast('No se puede borrar un plan con suscripciones activas', 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setDraft(emptyDraft(plans.length))}>
          <Plus className="h-4 w-4" />
          {t.admin.newPlan}
        </Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={<Package className="h-7 w-7" />}
          title={t.common.empty}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className={cn(
                'flex flex-col rounded-2xl bg-white p-6 shadow-chip',
                !plan.isActive && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-lg font-bold text-ink">{plan.name}</h3>
                <div className="flex shrink-0 gap-1.5">
                  {!plan.isActive && <Badge tone="neutral">{t.common.inactive}</Badge>}
                  <Badge tone="brand">
                    {plan.interval === 'month' ? t.admin.monthly : t.admin.yearly}
                  </Badge>
                </div>
              </div>

              <p className="mt-3 font-display text-2xl font-bold text-ink">
                {formatMoney(plan.priceCents, plan.currency)}
              </p>
              {plan.description && <p className="mt-2 text-sm text-ink-300">{plan.description}</p>}

              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-500">
                <li className="flex justify-between">
                  <span>{t.admin.maxTables}</span>
                  <span className="font-bold text-ink-700">{plan.maxTables ?? t.admin.unlimited}</span>
                </li>
                <li className="flex justify-between">
                  <span>{t.admin.maxProducts}</span>
                  <span className="font-bold text-ink-700">{plan.maxProducts ?? t.admin.unlimited}</span>
                </li>
                <li className="flex justify-between">
                  <span>{t.admin.maxStaff}</span>
                  <span className="font-bold text-ink-700">{plan.maxStaff ?? t.admin.unlimited}</span>
                </li>
                {plan.trialDays > 0 && (
                  <li className="flex justify-between">
                    <span>{t.admin.trialDays}</span>
                    <span className="font-bold text-ink-700">{plan.trialDays}</span>
                  </li>
                )}
                {plan.allows3d && (
                  <li className="flex items-center gap-2 pt-1 text-brand">
                    <Box className="h-4 w-4" />
                    {t.dashboard.model3d}
                  </li>
                )}
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-ink-600">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-success" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex items-center justify-between border-t border-surface-line pt-4">
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-300">
                  <Users className="h-3.5 w-3.5" />
                  {plan.subscribers}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...plan })}
                    aria-label={t.common.edit}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-surface-field hover:text-ink"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(plan.id)}
                    disabled={plan.subscribers > 0}
                    aria-label={t.common.delete}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-red-50 hover:text-state-danger disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.admin.editPlan : t.admin.newPlan}
        size="lg"
        footer={
          <Button size="block" loading={saving} onClick={submit}>
            {t.common.save}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-5">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              label={t.admin.planName}
              placeholder="Pro"
              required
            />
            <Textarea
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              label={t.common.description}
              rows={2}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                value={draft.interval}
                onChange={(e) =>
                  setDraft({ ...draft, interval: e.target.value as Enums<'plan_interval'> })
                }
                label={t.admin.planInterval}
              >
                <option value="month">{t.admin.monthly}</option>
                <option value="year">{t.admin.yearly}</option>
              </Select>
              <Select
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                label="Divisa"
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </Select>
              <Input
                defaultValue={formatAmount(draft.priceCents, decimals)}
                onBlur={(e) => setDraft({ ...draft, priceCents: parseAmount(e.target.value, decimals) })}
                label={t.common.price}
                inputMode="decimal"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="number"
                value={draft.trialDays}
                onChange={(e) => setDraft({ ...draft, trialDays: Number(e.target.value) })}
                label={t.admin.trialDays}
                min={0}
              />
              <Input
                value={draft.stripePriceId ?? ''}
                onChange={(e) => setDraft({ ...draft, stripePriceId: e.target.value })}
                label="Stripe price ID"
                placeholder="price_1..."
                hint="Opcional: si lo dejas vacío se crea el precio al vuelo."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <LimitInput
                label={t.admin.maxTables}
                value={draft.maxTables}
                unlimited={t.admin.unlimited}
                onChange={(v) => setDraft({ ...draft, maxTables: v })}
              />
              <LimitInput
                label={t.admin.maxProducts}
                value={draft.maxProducts}
                unlimited={t.admin.unlimited}
                onChange={(v) => setDraft({ ...draft, maxProducts: v })}
              />
              <LimitInput
                label={t.admin.maxStaff}
                value={draft.maxStaff}
                unlimited={t.admin.unlimited}
                onChange={(v) => setDraft({ ...draft, maxStaff: v })}
              />
            </div>

            <div>
              <span className="label">{t.admin.features}</span>
              <div className="flex gap-2">
                <input
                  value={featureDraft}
                  onChange={(e) => setFeatureDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const value = featureDraft.trim();
                      if (value && !draft.features.includes(value)) {
                        setDraft({ ...draft, features: [...draft.features, value] });
                        setFeatureDraft('');
                      }
                    }
                  }}
                  className="field flex-1"
                  placeholder="Estadísticas avanzadas"
                />
                <button
                  type="button"
                  onClick={() => {
                    const value = featureDraft.trim();
                    if (value && !draft.features.includes(value)) {
                      setDraft({ ...draft, features: [...draft.features, value] });
                      setFeatureDraft('');
                    }
                  }}
                  className="btn-ghost px-4"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {draft.features.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {draft.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-ink-600">
                      <Check className="h-3.5 w-3.5 text-state-success" />
                      <span className="flex-1">{feature}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, features: draft.features.filter((f) => f !== feature) })
                        }
                        aria-label={t.common.delete}
                        className="text-ink-300 hover:text-state-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3 rounded-xl bg-surface-field p-4">
              <Switch
                checked={draft.allows3d}
                onChange={(v) => setDraft({ ...draft, allows3d: v })}
                label={t.dashboard.model3d}
              />
              <Switch
                checked={draft.allowsDelivery}
                onChange={(v) => setDraft({ ...draft, allowsDelivery: v })}
                label={t.cart.delivery}
              />
              <Switch
                checked={draft.isActive}
                onChange={(v) => setDraft({ ...draft, isActive: v })}
                label={t.common.active}
              />
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={remove}
        title={t.common.delete}
        message={t.common.confirm}
        confirmLabel={t.common.delete}
        cancelLabel={t.common.cancel}
        loading={saving}
      />
    </>
  );
}

/** Campo numérico con casilla "ilimitado" (null en la BD). */
function LimitInput({
  label,
  value,
  unlimited,
  onChange,
}: {
  label: string;
  value: number | null;
  unlimited: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        placeholder={unlimited}
        min={0}
        className="field"
      />
      <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-300">
        <input
          type="checkbox"
          checked={value === null}
          onChange={(e) => onChange(e.target.checked ? null : 0)}
          className="accent-brand"
        />
        {unlimited}
      </label>
    </div>
  );
}
