'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BadgePercent, Check, Loader2, LogIn, X } from 'lucide-react';
import { useActiveCart } from '@/components/storefront/cart-provider';
import { cartToOrderItems } from '@/lib/cart';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

type ValidationResult = {
  ok: boolean;
  error?: string;
  code?: string;
  kind?: 'percentage' | 'fixed' | 'free_delivery';
  description?: string | null;
  discount_cents?: number;
  min_order_cents?: number;
};

/**
 * Campo de cupón.
 *
 * La validación la hace el servidor y devuelve ya el importe descontado, así
 * que el cliente nunca decide cuánto se rebaja: aquí solo se enseña el
 * resultado y se guarda el código para mandarlo con el pedido.
 */
export function CouponField({
  slug,
  orderType,
  currency,
  currencyDecimals,
  isSignedIn,
  className,
}: {
  slug: string;
  orderType: Enums<'order_type'>;
  currency: string;
  currencyDecimals: number;
  isSignedIn: boolean;
  className?: string;
}) {
  const t = useT();
  const cart = useActiveCart();
  const lines = cart((s) => s.lines);
  const coupon = cart((s) => s.coupon);
  const setCoupon = cart((s) => s.setCoupon);

  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const MESSAGES: Record<string, string> = {
    COUPON_NOT_FOUND: t.coupon.notFound,
    COUPON_INACTIVE: t.coupon.inactive,
    COUPON_NOT_STARTED: t.coupon.notStarted,
    COUPON_EXPIRED: t.coupon.expired,
    COUPON_EXHAUSTED: t.coupon.exhausted,
    COUPON_ALREADY_USED: t.coupon.alreadyUsed,
    COUPON_NOT_APPLICABLE: t.coupon.notApplicable,
    MIN_ORDER_NOT_REACHED: t.coupon.minOrder,
    LOGIN_REQUIRED: t.coupon.loginRequired,
    RESTAURANT_NOT_FOUND: t.common.error,
  };

  async function apply() {
    const trimmed = code.trim();
    if (!trimmed) return;

    setChecking(true);
    setError(null);
    setNeedsLogin(false);

    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc('validate_coupon', {
        p_code: trimmed,
        p_restaurant_slug: slug,
        p_items: cartToOrderItems(lines),
        p_type: orderType,
      });

      if (rpcError) {
        setError(t.common.error);
        return;
      }

      const result = data as unknown as ValidationResult;

      if (!result?.ok) {
        const reason = result?.error ?? 'COUPON_NOT_FOUND';
        setError(MESSAGES[reason] ?? t.coupon.notApplicable);
        setNeedsLogin(reason === 'LOGIN_REQUIRED');
        return;
      }

      setCoupon({
        code: result.code ?? trimmed.toUpperCase(),
        kind: result.kind ?? 'fixed',
        discountCents: result.discount_cents ?? 0,
        description: result.description ?? null,
      });
      setCode('');
    } catch {
      setError(t.common.error);
    } finally {
      setChecking(false);
    }
  }

  if (coupon) {
    return (
      <div className={cn('flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3', className)}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-emerald-800">{coupon.code}</p>
          <p className="truncate text-xs text-emerald-700">
            {coupon.kind === 'free_delivery'
              ? t.coupon.freeDelivery
              : `−${formatMoney(coupon.discountCents, currency, currencyDecimals)}`}
            {coupon.description ? ` · ${coupon.description}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCoupon(null)}
          aria-label={t.common.delete}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="label flex items-center gap-1.5">
        <BadgePercent className="h-3.5 w-3.5" />
        {t.coupon.title}
      </label>

      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
          placeholder={t.coupon.placeholder}
          maxLength={32}
          spellCheck={false}
          aria-label={t.coupon.title}
          className="field flex-1 bg-white font-mono uppercase tracking-wider"
        />
        <button
          type="button"
          onClick={apply}
          disabled={checking || !code.trim()}
          className="btn-primary px-5 text-xs"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t.coupon.apply}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs font-semibold text-state-danger">
          {error}
          {needsLogin && !isSignedIn && (
            <Link
              href={`/login?next=${encodeURIComponent(`/r/${slug}/cart`)}`}
              className="ml-2 inline-flex items-center gap-1 underline"
            >
              <LogIn className="h-3 w-3" />
              {t.auth.signIn}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
