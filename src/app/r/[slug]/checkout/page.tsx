import { notFound } from 'next/navigation';
import { getRestaurantBySlug, deliveryAllowed } from '@/lib/queries/public';
import { getTableSessionFor } from '@/lib/table-session';
import { getSessionProfile } from '@/lib/auth';
import { getCustomerLocation } from '@/lib/customer-location';
import {
  CheckoutView,
  type DeliverySlot,
  type OnlineMethod,
} from '@/components/storefront/checkout-view';
import { createPublicSupabase, createServerSupabase } from '@/lib/supabase/server';
import { listPlaces } from '@/lib/queries/places';
import type { Enums } from '@/types/database';

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { slug } = await params;
  const { type } = await searchParams;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const supabase = createPublicSupabase();
  const sesion = await createServerSupabase();

  const [table, profile, location, permiteReparto, { data: franjas }, countries] =
    await Promise.all([
      getTableSessionFor(slug),
      getSessionProfile(),
      getCustomerLocation(),
      deliveryAllowed(restaurant.id),
      // Una semana por delante: más allá, la gente no sabe si estará en casa.
      supabase.rpc('available_delivery_slots', { p_restaurant_id: restaurant.id, p_days: 7 }),
      listPlaces(),
    ]);

  /*
   * La libreta de direcciones del cliente.
   *
   * Antes esto salía de la cookie de ubicación, donde la dirección es opcional:
   * quien sólo había elegido ciudad acababa pidiendo a «Dabeiba». Ahora sale de
   * su cuenta, con la sesión, y las políticas se encargan de que sólo vea las
   * suyas. Sin sesión no hay libreta, y a domicilio la sesión es obligatoria.
   */
  const { data: addresses } = profile
    ? await sesion
        .from('customer_addresses')
        .select(
          'id, label, country, city, neighborhood, street, details, notes, full_line, is_default',
        )
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
    : { data: null };

  // Las formas de cobro por internet que este local tiene encendidas y con
  // llaves. Sin llaves no salen: un botón de pagar que falla es peor que no
  // ofrecerlo.
  const { data: enLinea } = await supabase.rpc('merchant_payment_options', {
    p_restaurant_id: restaurant.id,
  });

  // `full_line` es columna generada y nunca viene vacía, pero el tipo la da por
  // anulable porque no lleva NOT NULL. Se compone aquí el mismo texto en vez de
  // dejar pasar una dirección en blanco.
  const libreta = (addresses ?? []).map((a) => ({
    ...a,
    full_line:
      a.full_line ??
      [a.street, a.details, a.neighborhood, a.city].filter(Boolean).join(', '),
  }));

  const tableCode = table?.code ?? null;

  const requested = (['dine_in', 'delivery', 'pickup'] as const).includes(
    type as Enums<'order_type'>,
  )
    ? (type as Enums<'order_type'>)
    : tableCode
      ? 'dine_in'
      : permiteReparto
        ? 'delivery'
        : 'pickup';

  return (
    <CheckoutView
      slug={slug}
      orderType={requested}
      tableCode={tableCode}
      tableSession={table?.sessionId ?? null}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      deliveryFeeCents={restaurant.delivery_fee_cents}
      taxRate={Number(restaurant.tax_rate)}
      accepts={{
        cash: restaurant.accepts_cash,
        card: restaurant.accepts_card,
        tpv: restaurant.accepts_tpv,
      }}
      customer={{
        name: profile?.full_name ?? '',
        phone: profile?.phone ?? '',
        email: profile?.email ?? '',
      }}
      isSignedIn={Boolean(profile)}
      addresses={libreta}
      countries={countries}
      defaultCity={location?.city ?? profile?.city ?? restaurant.city ?? null}
      defaultCountry={restaurant.country ?? null}
      country={restaurant.country ?? null}
      prepayDelivery={restaurant.prepay_delivery ?? false}
      slots={(franjas as unknown as DeliverySlot[]) ?? []}
      online={(enLinea as unknown as OnlineMethod[]) ?? []}
    />
  );
}
