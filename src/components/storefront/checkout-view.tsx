'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banknote, CreditCard, Smartphone } from 'lucide-react';
import { ScreenHeader } from '@/components/ui/misc';
import { Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useCart, lineTotal, cartToOrderItems } from '@/lib/cart';
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
  };
  return map[code] ?? t.common.error;
}

export function CheckoutView({
  slug,
  orderType,
  tableCode,
  currency,
  currencyDecimals,
  deliveryFeeCents,
  taxRate,
  accepts,
  customer,
}: {
  slug: string;
  orderType: Enums<'order_type'>;
  tableCode: string | null;
  currency: string;
  currencyDecimals: number;
  deliveryFeeCents: number;
  taxRate: number;
  accepts: { cash: boolean; card: boolean; tpv: boolean };
  customer: { name: string; phone: string; email: string };
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const lines = useCart((s) => s.lines);
  const clear = useCart((s) => s.clear);

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
  const [address, setAddress] = useState('');
  const [addressNotes, setAddressNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const delivery = orderType === 'delivery' ? deliveryFeeCents : 0;
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + delivery + tax;

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
        p_customer_name: name.trim() || null,
        p_customer_phone: phone.trim() || null,
        p_customer_email: email.trim() || null,
        p_address: orderType === 'delivery' ? address.trim() : null,
        p_address_notes: addressNotes.trim() || null,
        p_notes: notes.trim() || null,
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

      clear();
      toast(t.checkout.success, 'success');
      router.push(`/order/${result.token}`);
    } catch {
      toast(t.common.error, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ScreenHeader title={t.checkout.title} backHref={`/r/${slug}/cart`} />

      <div className="flex-1 px-5 pb-6">
        <section>
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

        <section className="mt-7 space-y-4">
          <p className="label">{t.checkout.yourData}</p>
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

          {orderType === 'delivery' && (
            <>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                label={t.cart.deliveryAddress}
                placeholder="Calle, número, piso"
                autoComplete="street-address"
              />
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

        <section className="mt-7 rounded-2xl bg-surface-field p-5">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">{t.common.subtotal}</dt>
              <dd className="font-semibold text-ink-600">
                {formatMoney(subtotal, currency, currencyDecimals)}
              </dd>
            </div>
            {delivery > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">{t.common.delivery}</dt>
                <dd className="font-semibold text-ink-600">
                  {formatMoney(delivery, currency, currencyDecimals)}
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
          disabled={submitting || lines.length === 0}
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
