'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banknote, CreditCard, MapPin, Pencil, Smartphone } from 'lucide-react';
import { ScreenHeader } from '@/components/ui/misc';
import { CheckoutIdentity } from '@/components/storefront/checkout-identity';
import { Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { lineTotal, cartToOrderItems } from '@/lib/cart';
import { useActiveCart, useCartContext } from '@/components/storefront/cart-provider';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import type { Enums } from '@/types/database';

type PayMethod = Extract<Enums<'payment_method'>, 'cash' | 'card' | 'tpv'>;

/** Traduce los códigos de error que lanza place_order a un mensaje legible. */
function errorMessage(raw: string, t: ReturnType<typeof useT>): string {
  const code = raw.split(':')[0];
  const map: Record<string, string> = {
    EMPTY_CART: t.cart.empty,
    RESTAURANT_CLOSED: t.storefront.closed,
    TABLE_NOT_FOUND: t.table.invalidTable,
    TABLE_REQUIRED: t.table.scanAgain,
    ADDRESS_REQUIRED: t.cart.deliveryAddress,
    RESTAURANT_SUBSCRIPTION_INACTIVE: t.subscription.expiredWarning,
    COUPON_NOT_FOUND: t.coupon.notFound,
    COUPON_INACTIVE: t.coupon.inactive,
    COUPON_EXPIRED: t.coupon.expired,
    COUPON_EXHAUSTED: t.coupon.exhausted,
    COUPON_ALREADY_USED: t.coupon.alreadyUsed,
    COUPON_NOT_APPLICABLE: t.coupon.notApplicable,
    COUPON_MIN_ORDER: t.coupon.minOrder,
    LOGIN_REQUIRED: t.coupon.loginRequired,
  };
  return map[code] ?? t.common.error;
}

export function CheckoutView({
  slug,
  orderType,
  tableCode,
  tableSession,
  currency,
  currencyDecimals,
  deliveryFeeCents,
  taxRate,
  accepts,
  customer,
  isSignedIn,
  savedLocation,
}: {
  slug: string;
  orderType: Enums<'order_type'>;
  tableCode: string | null;
  /** Turno de la mesa que traía el navegador al escanear el QR. */
  tableSession: string | null;
  currency: string;
  currencyDecimals: number;
  deliveryFeeCents: number;
  taxRate: number;
  accepts: { cash: boolean; card: boolean; tpv: boolean };
  customer: { name: string; phone: string; email: string };
  isSignedIn: boolean;
  savedLocation: { city: string; address: string | null } | null;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { inTable } = useCartContext();
  const cart = useActiveCart();
  const lines = cart((s) => s.lines);
  const coupon = cart((s) => s.coupon);
  const clear = cart((s) => s.clear);

  const ALL_METHODS = [
    { id: 'cash', icon: Banknote, label: t.checkout.cash, hint: t.checkout.cashHint },
    { id: 'card', icon: CreditCard, label: t.checkout.card, hint: t.checkout.cardHint },
    { id: 'tpv', icon: Smartphone, label: t.checkout.tpv, hint: t.checkout.tpvHint },
  ] satisfies { id: PayMethod; icon: typeof Banknote; label: string; hint: string }[];

  const methods = ALL_METHODS.filter((m) => accepts[m.id]);

  const [method, setMethod] = useState<PayMethod>(methods[0]?.id ?? 'cash');
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email);
  /*
   * En mesa no se pide cuenta: el comensal ya está sentado en el local, su
   * comanda vive en la cuenta de la mesa y el camarero la tiene delante.
   * Obligarle a registrarse ahí solo añade fricción a alguien que ya está
   * dentro. Fuera del local sí hace falta, porque sin cuenta pierde el
   * seguimiento en cuanto cierra la pestaña.
   */
  const requiresAccount = !inTable;
  const [signedIn, setSignedIn] = useState(isSignedIn);

  /*
   * La sesión se comprueba contra el cliente de Supabase y no solo contra lo
   * que trajo el servidor: al iniciar sesión aquí mismo, el estado del servidor
   * puede llegar todavía sin cookie y dejaría el botón bloqueado con la sesión
   * ya abierta.
   */
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setSignedIn(true);
    });

    /** Rellena los datos del pedido con el perfil, para no preguntar dos veces. */
    async function hydrateFromProfile(userId: string) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, email')
        .eq('id', userId)
        .maybeSingle();
      if (!active || !profile) return;

      setName((current) => current || profile.full_name || '');
      setPhone((current) => current || profile.phone || '');
      setEmail((current) => current || profile.email || '');
    }

    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) void hydrateFromProfile(data.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSignedIn(Boolean(session));
      if (session?.user) void hydrateFromProfile(session.user.id);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  // La dirección guardada evita volver a pedirle al cliente lo que ya nos dijo.
  const savedFull = savedLocation
    ? [savedLocation.address, savedLocation.city].filter(Boolean).join(', ')
    : '';
  const [address, setAddress] = useState(savedFull);
  const [editingAddress, setEditingAddress] = useState(!savedFull);
  // Con sesión los datos personales llegan del perfil: solo se editan a petición.
  const [editingData, setEditingData] = useState(!isSignedIn);

  const [addressNotes, setAddressNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const rawDelivery = orderType === 'delivery' ? deliveryFeeCents : 0;
  const freeDelivery = coupon?.kind === 'free_delivery';
  const delivery = freeDelivery ? Math.max(rawDelivery - coupon.discountCents, 0) : rawDelivery;
  const discount = coupon && !freeDelivery ? coupon.discountCents : 0;
  const tax = Math.round(Math.max(subtotal - discount, 0) * taxRate);
  const total = Math.max(subtotal - discount + delivery + tax, 0);

  async function submit() {
    if (lines.length === 0) {
      toast(t.cart.empty, 'error');
      return;
    }
    if (orderType === 'delivery' && !address.trim()) {
      toast(t.cart.deliveryAddress, 'error');
      return;
    }
    if (orderType !== 'dine_in' && !name.trim()) {
      toast(t.common.required, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('place_order', {
        p_restaurant_slug: slug,
        p_items: cartToOrderItems(lines),
        p_type: orderType,
        p_payment_method: method,
        p_table_code: tableCode,
        // El turno de la mesa. La función lo exige desde la migración 0035:
        // sin él, cualquiera con un enlace antiguo podía colar comandas en la
        // cuenta de quien estuviera sentado en ese momento.
        p_table_session: tableSession,
        p_customer_name: name.trim() || null,
        p_customer_phone: phone.trim() || null,
        p_customer_email: email.trim() || null,
        p_address: orderType === 'delivery' ? address.trim() : null,
        p_address_notes: addressNotes.trim() || null,
        p_notes: notes.trim() || null,
        p_coupon_code: coupon?.code ?? null,
      });

      if (error) {
        toast(errorMessage(error.message, t), 'error');
        return;
      }

      const result = data as { token?: string } | null;
      if (!result?.token) {
        toast(t.common.error, 'error');
        return;
      }

      // La cesta de la mesa se conserva a propósito: el comensal sigue viendo
      // su cuenta abierta hasta que el restaurante la marca como cobrada.
      clear();
      toast(t.checkout.success, 'success');
      router.push(inTable ? `/r/${slug}/table` : `/order/${result.token}`);
    } catch {
      toast(t.common.error, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScreenHeader title={t.checkout.title} backHref={`/r/${slug}/cart`} />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {requiresAccount && !signedIn && (
          <div className="mb-7">
            <CheckoutIdentity
              defaultName={name}
              defaultEmail={email}
              defaultPhone={phone}
              onReady={() => setSignedIn(true)}
            />
          </div>
        )}

        <section className={cn(requiresAccount && !signedIn && 'pointer-events-none opacity-40')}>
          <p className="label">{t.checkout.paymentMethod}</p>
          <div className="grid grid-cols-3 gap-3">
            {methods.map(({ id, icon: Icon, label }) => {
              const active = method === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMethod(id)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-2xl border-2 px-2 py-4 transition-colors',
                    active
                      ? 'border-brand bg-brand-50 text-brand-700'
                      : 'border-transparent bg-surface-field text-ink-500 hover:bg-surface-muted',
                  )}
                >
                  <Icon className="h-6 w-6" />
                  <span className="text-xs font-bold">{label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-xs text-ink-300">
            {methods.find((m) => m.id === method)?.hint}
          </p>
        </section>

        <section
          className={cn('mt-7 space-y-4', requiresAccount && !signedIn && 'pointer-events-none opacity-40')}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="label mb-0">{t.checkout.yourData}</p>
            {signedIn && !editingData && (
              <button
                type="button"
                onClick={() => setEditingData(true)}
                className="inline-flex items-center gap-1 text-xs font-bold text-brand"
              >
                <Pencil className="h-3 w-3" />
                {t.checkout.changeAddress}
              </button>
            )}
          </div>

          {signedIn && !editingData && (name || email) && (
            <div className="rounded-xl bg-surface-field px-4 py-3">
              <p className="text-sm font-semibold text-ink-700">{name || email}</p>
              <p className="mt-0.5 text-xs text-ink-300">
                {[phone, email].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}
          {(editingData || !signedIn) && (
            <>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                label={t.auth.fullName}
                placeholder={t.auth.fullName}
                autoComplete="name"
              />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                label={t.auth.phone}
                type="tel"
                placeholder="+34 600 000 000"
                autoComplete="tel"
              />
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                label={`${t.auth.email} (${t.common.optional})`}
                type="email"
                autoComplete="email"
              />
            </>
          )}

          {orderType === 'delivery' && (
            <>
              {!editingAddress && savedFull ? (
                <div className="flex items-start gap-3 rounded-xl bg-brand-50 px-4 py-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-brand-700">
                      {t.checkout.usingSavedAddress}
                    </p>
                    <p className="truncate text-sm font-semibold text-ink-700">{address}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingAddress(true)}
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-brand"
                  >
                    <Pencil className="h-3 w-3" />
                    {t.checkout.changeAddress}
                  </button>
                </div>
              ) : (
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  label={t.cart.deliveryAddress}
                  placeholder="Calle, número, piso"
                  autoComplete="street-address"
                />
              )}
              <Input
                value={addressNotes}
                onChange={(e) => setAddressNotes(e.target.value)}
                label={`${t.common.description} (${t.common.optional})`}
                placeholder={t.checkout.orderNotesPlaceholder}
              />
            </>
          )}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            label={t.checkout.orderNotes}
            placeholder={t.checkout.orderNotesPlaceholder}
            rows={2}
            maxLength={300}
          />
        </section>

        <section
          className={cn('mt-7 rounded-2xl bg-surface-field p-5', requiresAccount && !signedIn && 'opacity-40')}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">{t.common.subtotal}</dt>
              <dd className="font-semibold text-ink-600">
                {formatMoney(subtotal, currency, currencyDecimals)}
              </dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>
                  {t.common.discount} · {coupon?.code}
                </dt>
                <dd className="font-semibold">
                  −{formatMoney(discount, currency, currencyDecimals)}
                </dd>
              </div>
            )}
            {rawDelivery > 0 && (
              <div className="flex justify-between">
                <dt className={freeDelivery ? 'text-emerald-700' : 'text-ink-400'}>
                  {t.common.delivery}
                </dt>
                <dd className={freeDelivery ? 'font-semibold text-emerald-700' : 'font-semibold text-ink-600'}>
                  {freeDelivery ? t.common.free : formatMoney(delivery, currency, currencyDecimals)}
                </dd>
              </div>
            )}
            {tax > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">{t.common.taxes}</dt>
                <dd className="font-semibold text-ink-600">
                  {formatMoney(tax, currency, currencyDecimals)}
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      <div className="bottom-bar">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-300">
            {t.common.total}
          </span>
          <span className="font-display text-2xl font-bold text-ink">
            {formatMoney(total, currency, currencyDecimals)}
          </span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || lines.length === 0 || (requiresAccount && !signedIn)}
          className="btn-primary w-full py-4 text-[15px] uppercase tracking-wide"
        >
          {submitting
            ? t.checkout.processing
            : method === 'cash'
              ? t.checkout.confirmOrder
              : t.checkout.payAndConfirm}
        </button>
      </div>
    </div>
  );
}
