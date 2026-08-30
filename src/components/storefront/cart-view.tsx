'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bike, ShoppingBag, Store, UtensilsCrossed, X } from 'lucide-react';
import { ScreenHeader, EmptyState, QuantityStepper } from '@/components/ui/misc';
import { CouponField } from '@/components/storefront/coupon-field';
import { useActiveCart, useCartContext } from '@/components/storefront/cart-provider';
import { lineTotal } from '@/lib/cart';
import { formatMoney } from '@/lib/money';
import { useT, interpolate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

export function CartView({
  slug,
  currency,
  currencyDecimals,
  deliveryFeeCents,
  minOrderCents,
  taxRate,
  allows,
  isSignedIn,
}: {
  slug: string;
  currency: string;
  currencyDecimals: number;
  deliveryFeeCents: number;
  minOrderCents: number;
  taxRate: number;
  allows: { dineIn: boolean; delivery: boolean; pickup: boolean };
  isSignedIn: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { inTable } = useCartContext();
  const cart = useActiveCart();

  const lines = cart((s) => s.lines);
  const coupon = cart((s) => s.coupon);
  const updateQuantity = cart((s) => s.updateQuantity);
  const removeLine = cart((s) => s.removeLine);

  /**
   * Desde la mesa el único tipo posible es "en mesa": el cliente está sentado
   * en el local. Domicilio y recogida se piden desde el carrito general, que es
   * otra cesta distinta.
   */
  const available: Enums<'order_type'>[] = inTable
    ? ['dine_in']
    : ([allows.delivery ? 'delivery' : null, allows.pickup ? 'pickup' : null].filter(
        Boolean,
      ) as Enums<'order_type'>[]);

  const [orderType, setOrderType] = useState<Enums<'order_type'>>(available[0] ?? 'delivery');

  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const rawDelivery = orderType === 'delivery' ? deliveryFeeCents : 0;
  const freeDelivery = coupon?.kind === 'free_delivery';
  const delivery = freeDelivery ? Math.max(rawDelivery - coupon.discountCents, 0) : rawDelivery;
  const discount = coupon && !freeDelivery ? coupon.discountCents : 0;
  const tax = Math.round(Math.max(subtotal - discount, 0) * taxRate);
  const total = Math.max(subtotal - discount + delivery + tax, 0);

  const belowMinimum = orderType === 'delivery' && subtotal < minOrderCents;

  if (lines.length === 0) {
    return (
      <>
        <ScreenHeader title={t.cart.title} backHref={`/r/${slug}`} />
        <EmptyState
          icon={<ShoppingBag className="h-7 w-7" />}
          title={t.cart.empty}
          description={t.cart.emptyHint}
          action={
            <Link href={`/r/${slug}`} className="btn-primary">
              {t.cart.startOrder}
            </Link>
          }
        />
      </>
    );
  }

  const TYPE_META: Record<Enums<'order_type'>, { icon: typeof Bike; label: string }> = {
    dine_in: { icon: UtensilsCrossed, label: t.cart.dineIn },
    delivery: { icon: Bike, label: t.cart.delivery },
    pickup: { icon: Store, label: t.cart.pickup },
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader title={t.cart.title} backHref={`/r/${slug}`} />

      <ul className="flex-1 divide-y divide-surface-line px-5">
        {lines.map((line) => (
          <li key={line.key} className="flex gap-4 py-4 animate-fade-up">
            <span className="relative h-[90px] w-[90px] shrink-0 overflow-hidden rounded-xl bg-surface-muted">
              {line.image ? (
                <Image src={line.image} alt={line.name} fill sizes="90px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-ink-200">
                  <ShoppingBag className="h-6 w-6" />
                </span>
              )}
            </span>

            <div className="flex min-w-0 flex-1 flex-col justify-between">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold leading-snug text-ink-700">{line.name}</p>
                  {line.options.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-ink-300">
                      {line.options.map((o) => o.name).join(' · ')}
                    </p>
                  )}
                  {line.notes && (
                    <p className="mt-0.5 truncate text-xs italic text-ink-300">“{line.notes}”</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  aria-label={t.cart.remove}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-state-danger text-white transition-transform active:scale-90"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={3} />
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-lg font-bold text-ink">
                  {formatMoney(lineTotal(line), currency, currencyDecimals)}
                </span>
                <QuantityStepper
                  value={line.quantity}
                  onChange={(q) => updateQuantity(line.key, q)}
                  min={0}
                  tone="light"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-t-sheet bg-surface-field px-5 pb-5 pt-6">
        {available.length > 1 ? (
          <>
            <p className="label">{t.cart.orderType}</p>
            <div className="mb-5 grid grid-cols-2 gap-2">
              {available.map((type) => {
                const { icon: Icon, label } = TYPE_META[type];
                const active = orderType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOrderType(type)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-bold transition-all duration-200 active:scale-[0.97]',
                      active
                        ? 'bg-brand text-brand-contrast shadow-[0_8px_18px_-10px_rgb(var(--brand-rgb))]'
                        : 'bg-white text-ink-600 hover:bg-surface-muted',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="mb-5 flex items-center gap-2.5 rounded-xl bg-white px-4 py-3">
            {(() => {
              const { icon: Icon, label } = TYPE_META[available[0] ?? 'delivery'];
              return (
                <>
                  <Icon className="h-4 w-4 text-brand" />
                  <span className="text-sm font-bold text-ink-600">{label}</span>
                </>
              );
            })()}
          </div>
        )}

        <CouponField
          slug={slug}
          orderType={orderType}
          currency={currency}
          currencyDecimals={currencyDecimals}
          isSignedIn={isSignedIn}
          className="mb-5"
        />

        <dl className="space-y-2 text-sm">
          <Row label={t.common.subtotal} value={formatMoney(subtotal, currency, currencyDecimals)} />
          {discount > 0 && (
            <Row
              label={`${t.common.discount} · ${coupon?.code ?? ''}`}
              value={`−${formatMoney(discount, currency, currencyDecimals)}`}
              tone="discount"
            />
          )}
          {rawDelivery > 0 && (
            <Row
              label={t.common.delivery}
              value={
                freeDelivery
                  ? t.common.free
                  : formatMoney(delivery, currency, currencyDecimals)
              }
              tone={freeDelivery ? 'discount' : undefined}
            />
          )}
          {tax > 0 && <Row label={t.common.taxes} value={formatMoney(tax, currency, currencyDecimals)} />}
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-surface-line pt-4">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-300">
            {t.common.total}
          </span>
          <span className="font-display text-2xl font-bold text-ink">
            {formatMoney(total, currency, currencyDecimals)}
          </span>
        </div>

        {belowMinimum && (
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
            {interpolate(t.cart.minOrderNotReached, {
              amount: formatMoney(minOrderCents, currency, currencyDecimals),
            })}
          </p>
        )}

        <button
          type="button"
          disabled={belowMinimum}
          onClick={() => router.push(`/r/${slug}/checkout?type=${orderType}`)}
          className="btn-primary mt-5 w-full py-4 text-[15px] uppercase tracking-wide"
        >
          {t.cart.placeOrder}
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'discount';
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn('text-ink-400', tone === 'discount' && 'text-emerald-700')}>{label}</dt>
      <dd
        className={cn(
          'font-semibold text-ink-600',
          tone === 'discount' && 'text-emerald-700',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
