'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BadgePercent, Bike, Globe2, Pencil, Plus, Store, Ticket, Trash2 } from 'lucide-react';
import { Sheet, ConfirmDialog } from '@/components/ui/sheet';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { saveCoupon, deleteCoupon } from '@/app/dashboard/coupons/actions';
import { formatAmount, parseAmount, formatMoney } from '@/lib/money';
import { useI18n } from '@/i18n/provider';
import { formatDate, cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type CouponRow = {
  id: string;
  code: string;
  kind: Enums<'coupon_kind'>;
  percentage: number | null;
  valueCents: number | null;
  maxDiscountCents: number | null;
  target: Enums<'coupon_target'>;
  minOrderCents: number;
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxPerCustomer: number;
  redemptionsCount: number;
  isActive: boolean;
  description: string | null;
  isGlobal: boolean;
  productIds: string[];
  categoryIds: string[];
};

type Draft = Omit<CouponRow, 'id' | 'redemptionsCount' | 'isGlobal'> & { id?: string };

function emptyDraft(): Draft {
  return {
    code: '',
    kind: 'percentage',
    percentage: 10,
    valueCents: null,
    maxDiscountCents: null,
    target: 'order',
    minOrderCents: 0,
    startsAt: new Date().toISOString(),
    endsAt: null,
    maxRedemptions: null,
    maxPerCustomer: 1,
    isActive: true,
    description: '',
    productIds: [],
    categoryIds: [],
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Gestión de cupones.
 *
 * El mismo componente sirve al restaurante y al superadministrador: `asGlobal`
 * decide si el cupón se guarda ligado al local o abierto a toda la plataforma.
 */
export function CouponsManager({
  coupons,
  products,
  categories,
  currency,
  currencyDecimals,
  asGlobal = false,
}: {
  coupons: CouponRow[];
  products: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  currency: string;
  currencyDecimals: number;
  asGlobal?: boolean;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ERRORS: Record<string, string> = {
    CODE_TAKEN: t.coupon.codeTaken,
    SCOPE_REQUIRED: t.coupon.scopeRequired,
    PERCENTAGE_REQUIRED: t.common.required,
    VALUE_REQUIRED: t.common.required,
    FREE_DELIVERY_ORDER_ONLY: t.coupon.freeDeliveryOrderOnly,
  };

  async function submit() {
    if (!draft?.code.trim()) {
      toast(t.common.required, 'error');
      return;
    }

    setSaving(true);
    const result = await saveCoupon(
      {
        id: draft.id,
        code: draft.code.trim(),
        kind: draft.kind,
        percentage: draft.kind === 'percentage' ? draft.percentage : null,
        value_cents: draft.kind === 'fixed' ? draft.valueCents : null,
        max_discount_cents: draft.maxDiscountCents,
        target: draft.target,
        min_order_cents: draft.minOrderCents,
        starts_at: draft.startsAt,
        ends_at: draft.endsAt,
        max_redemptions: draft.maxRedemptions,
        max_per_customer: draft.maxPerCustomer,
        is_active: draft.isActive,
        description: draft.description || null,
        product_ids: draft.productIds,
        category_ids: draft.categoryIds,
      },
      asGlobal,
    );
    setSaving(false);

    if (!result.ok) {
      toast(ERRORS[result.error] ?? t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!confirmId) return;
    setSaving(true);
    const result = await deleteCoupon(confirmId, asGlobal);
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  function describe(coupon: CouponRow): string {
    if (coupon.kind === 'free_delivery') return t.coupon.freeDelivery;
    if (coupon.kind === 'percentage') return `${coupon.percentage}%`;
    return formatMoney(coupon.valueCents ?? 0, currency, currencyDecimals);
  }

  const TARGET_LABEL: Record<Enums<'coupon_target'>, string> = {
    order: t.coupon.targetOrder,
    products: t.coupon.targetProducts,
    categories: t.coupon.targetCategories,
  };

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setDraft(emptyDraft())}>
          <Plus className="h-4 w-4" />
          {t.coupon.newCoupon}
        </Button>
      </div>

      {coupons.length === 0 ? (
        <EmptyState
          icon={<Ticket className="h-7 w-7" />}
          title={t.coupon.noCoupons}
          description={t.coupon.noCouponsHint}
          className="rounded-2xl bg-white shadow-chip"
        />
      ) : (
        <ul className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {coupons.map((coupon) => {
            const expired = coupon.endsAt && new Date(coupon.endsAt) < new Date();
            return (
              <li
                key={coupon.id}
                className={cn(
                  'lift rounded-2xl bg-white p-5 shadow-chip',
                  (!coupon.isActive || expired) && 'opacity-60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-lg font-bold tracking-wider text-ink">
                      {coupon.code}
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-brand">{describe(coupon)}</p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand">
                    {coupon.kind === 'free_delivery' ? (
                      <Bike className="h-5 w-5" />
                    ) : (
                      <BadgePercent className="h-5 w-5" />
                    )}
                  </span>
                </div>

                {coupon.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-ink-300">{coupon.description}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={coupon.isGlobal ? 'brand' : 'neutral'}>
                    {coupon.isGlobal ? (
                      <>
                        <Globe2 className="h-3 w-3" />
                        {t.coupon.global}
                      </>
                    ) : (
                      <>
                        <Store className="h-3 w-3" />
                        {TARGET_LABEL[coupon.target]}
                      </>
                    )}
                  </Badge>
                  {expired ? (
                    <Badge tone="danger">{t.admin.expired}</Badge>
                  ) : !coupon.isActive ? (
                    <Badge tone="neutral">{t.common.inactive}</Badge>
                  ) : null}
                </div>

                <dl className="mt-4 space-y-1 text-xs text-ink-400">
                  <div className="flex justify-between">
                    <dt>{t.coupon.redemptions}</dt>
                    <dd className="font-bold text-ink-600">
                      {coupon.redemptionsCount}
                      {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ''}
                    </dd>
                  </div>
                  {coupon.minOrderCents > 0 && (
                    <div className="flex justify-between">
                      <dt>{t.coupon.minOrderCents}</dt>
                      <dd className="font-bold text-ink-600">
                        {formatMoney(coupon.minOrderCents, currency, currencyDecimals)}
                      </dd>
                    </div>
                  )}
                  {coupon.endsAt && (
                    <div className="flex justify-between">
                      <dt>{t.admin.expiresOn}</dt>
                      <dd className="font-bold text-ink-600">{formatDate(coupon.endsAt, locale)}</dd>
                    </div>
                  )}
                </dl>

                <div className="mt-4 flex justify-end gap-1 border-t border-surface-line pt-3">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...coupon })}
                    aria-label={t.common.edit}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 hover:bg-surface-field hover:text-ink"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(coupon.id)}
                    aria-label={t.common.delete}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 hover:bg-red-50 hover:text-state-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t.common.edit : t.coupon.newCoupon}
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
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              label={t.coupon.code}
              placeholder="VERANO10"
              maxLength={32}
              spellCheck={false}
              className="font-mono uppercase tracking-wider"
              hint={asGlobal ? t.coupon.globalHint : t.coupon.ownHint}
              required
            />

            <Textarea
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              label={t.common.description}
              rows={2}
              maxLength={200}
            />

            <div>
              <span className="label">{t.coupon.kind}</span>
              <div className="grid grid-cols-3 gap-2">
                {(['percentage', 'fixed', 'free_delivery'] as const).map((kind) => {
                  const active = draft.kind === kind;
                  const label =
                    kind === 'percentage'
                      ? t.coupon.percentage
                      : kind === 'fixed'
                        ? t.coupon.fixed
                        : t.coupon.freeDeliveryKind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          kind,
                          // El envío gratis solo tiene sentido sobre el pedido entero.
                          target: kind === 'free_delivery' ? 'order' : draft.target,
                          percentage: kind === 'percentage' ? (draft.percentage ?? 10) : null,
                          valueCents: kind === 'fixed' ? (draft.valueCents ?? 500) : null,
                        })
                      }
                      className={cn(
                        'rounded-xl px-3 py-3 text-xs font-bold transition-colors',
                        active
                          ? 'bg-brand text-brand-contrast'
                          : 'bg-surface-field text-ink-500 hover:bg-surface-muted',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {draft.kind === 'percentage' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  type="number"
                  value={draft.percentage ?? ''}
                  onChange={(e) => setDraft({ ...draft, percentage: Number(e.target.value) })}
                  label="%"
                  min={1}
                  max={100}
                  step="0.5"
                />
                <Input
                  defaultValue={
                    draft.maxDiscountCents ? formatAmount(draft.maxDiscountCents, currencyDecimals) : ''
                  }
                  onBlur={(e) =>
                    setDraft({
                      ...draft,
                      maxDiscountCents: e.target.value
                        ? parseAmount(e.target.value, currencyDecimals)
                        : null,
                    })
                  }
                  label={`${t.coupon.maxDiscount} (${t.common.optional})`}
                  inputMode="decimal"
                />
              </div>
            )}

            {draft.kind === 'fixed' && (
              <Input
                defaultValue={draft.valueCents ? formatAmount(draft.valueCents, currencyDecimals) : ''}
                onBlur={(e) =>
                  setDraft({ ...draft, valueCents: parseAmount(e.target.value, currencyDecimals) })
                }
                label={`${t.coupon.value} (${currency})`}
                inputMode="decimal"
                placeholder="5,00"
              />
            )}

            {draft.kind !== 'free_delivery' && (
              <>
                <Select
                  value={draft.target}
                  onChange={(e) =>
                    setDraft({ ...draft, target: e.target.value as Enums<'coupon_target'> })
                  }
                  label={t.coupon.target}
                >
                  <option value="order">{t.coupon.targetOrder}</option>
                  <option value="products">{t.coupon.targetProducts}</option>
                  <option value="categories">{t.coupon.targetCategories}</option>
                </Select>

                {draft.target === 'products' && (
                  <PickList
                    label={t.coupon.selectProducts}
                    options={products}
                    selected={draft.productIds}
                    onChange={(ids) => setDraft({ ...draft, productIds: ids })}
                    empty={t.common.empty}
                  />
                )}

                {draft.target === 'categories' && (
                  <PickList
                    label={t.coupon.selectCategories}
                    options={categories}
                    selected={draft.categoryIds}
                    onChange={(ids) => setDraft({ ...draft, categoryIds: ids })}
                    empty={t.common.empty}
                  />
                )}
              </>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                defaultValue={formatAmount(draft.minOrderCents, currencyDecimals)}
                onBlur={(e) =>
                  setDraft({ ...draft, minOrderCents: parseAmount(e.target.value, currencyDecimals) })
                }
                label={t.coupon.minOrderCents}
                inputMode="decimal"
              />
              <Input
                type="number"
                value={draft.maxRedemptions ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxRedemptions: e.target.value ? Number(e.target.value) : null,
                  })
                }
                label={t.coupon.maxRedemptions}
                placeholder={t.coupon.unlimited}
                min={1}
              />
              <Input
                type="number"
                value={draft.maxPerCustomer}
                onChange={(e) => setDraft({ ...draft, maxPerCustomer: Number(e.target.value) })}
                label={t.coupon.maxPerCustomer}
                min={1}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="label">{t.admin.scheduleFrom}</span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.startsAt)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      startsAt: fromLocalInput(e.target.value) ?? new Date().toISOString(),
                    })
                  }
                  className="field"
                />
              </div>
              <div>
                <span className="label">
                  {t.admin.scheduleTo} ({t.common.optional})
                </span>
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.endsAt)}
                  onChange={(e) => setDraft({ ...draft, endsAt: fromLocalInput(e.target.value) })}
                  className="field"
                />
              </div>
            </div>

            <Switch
              checked={draft.isActive}
              onChange={(v) => setDraft({ ...draft, isActive: v })}
              label={t.common.active}
            />
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

/** Lista de casillas para acotar el cupón a platos o categorías. */
function PickList({
  label,
  options,
  selected,
  onChange,
  empty,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  empty: string;
}) {
  if (options.length === 0) {
    return (
      <div>
        <span className="label">{label}</span>
        <p className="text-sm text-ink-300">{empty}</p>
      </div>
    );
  }

  return (
    <div>
      <span className="label">
        {label} ({selected.length})
      </span>
      <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto rounded-xl bg-surface-field p-3">
        {options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() =>
                onChange(
                  active ? selected.filter((id) => id !== option.id) : [...selected, option.id],
                )
              }
              aria-pressed={active}
              className={cn(
                'rounded-full px-3.5 py-2 text-xs font-bold transition-colors',
                active
                  ? 'bg-brand text-brand-contrast'
                  : 'bg-white text-ink-500 hover:bg-surface-muted',
              )}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
