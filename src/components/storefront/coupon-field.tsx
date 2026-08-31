'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback} from 'react';
import { BadgePercent, Check, Loader2, LogIn, X } from 'lucide-react';
import { useActiveCart } from '@/components/storefront/cart-provider';
import { cartToOrderItems } from '@/lib/cart';
import { createClient } from '@/lib/supabase/client';
import { rememberCoupon, listMyCoupons, type SavedCoupon } from '@/app/actions/coupons';
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
  const [guardados, setGuardados] = useState<SavedCoupon[]>([]);
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

  const cargarGuardados = useCallback(async () => {
    const filas = await listMyCoupons().catch(() => []);
    // Los del propio restaurante y los de plataforma; los de otros locales no
    // sirven aquí y sólo darían un rechazo al aplicarlos.
    setGuardados(
      filas.filter((cupon) => !cupon.restaurant_id || cupon.restaurant_slug === slug),
    );
  }, [slug]);

  useEffect(() => {
    void cargarGuardados();
  }, [cargarGuardados]);

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

      const aplicado = result.code ?? trimmed.toUpperCase();
      setCoupon({
        code: aplicado,
        kind: result.kind ?? 'fixed',
        discountCents: result.discount_cents ?? 0,
        description: result.description ?? null,
      });
      setCode('');

      // Queda guardado en la cuenta para no tener que recordar el código la
      // próxima vez. Va sin esperar: el descuento ya está aplicado.
      void rememberCoupon(aplicado, slug).then(() => cargarGuardados());
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

      {/* Cupones que ya canjeó antes y siguen sirviendo: se aplican con un
          toque, sin tener que acordarse del código. */}
      {guardados.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold text-ink-400">{t.coupon.saved}</p>
          <div className="flex flex-wrap gap-2">
            {guardados.map((cupon) => (
              <button
                key={cupon.code}
                type="button"
                onClick={() => {
                  setCode(cupon.code);
                  void apply();
                }}
                disabled={checking}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand/50 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-50"
              >
                <BadgePercent className="h-3.5 w-3.5" />
                {cupon.code}
                {cupon.max_per_customer !== null && (
                  <span className="font-normal text-brand-700/70">
                    {cupon.max_per_customer - cupon.used}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

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
