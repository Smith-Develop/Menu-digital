import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { SettingsForm } from '@/components/dashboard/settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ajustes' };

export default async function SettingsPage() {
  const { restaurant } = await requireStaffContext();
  const { t } = await getI18n();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.settings}</h1>
      <SettingsForm
        restaurantId={restaurant.id}
        initial={{
          name: restaurant.name,
          description: restaurant.description,
          phone: restaurant.phone,
          address: restaurant.address,
          city: restaurant.city,
          country: restaurant.country ?? 'ES',
          logoUrl: restaurant.logo_url,
          coverUrl: restaurant.cover_url,
          currency: restaurant.currency,
          currencyDecimals: restaurant.currency_decimals,
          timezone: restaurant.timezone,
          cuisineTags: restaurant.cuisine_tags,
          avgPrepMinutes: restaurant.avg_prep_minutes,
          deliveryFeeCents: restaurant.delivery_fee_cents,
          minOrderCents: restaurant.min_order_cents,
          taxRate: Number(restaurant.tax_rate),
          dineinEnabled: restaurant.dinein_enabled,
          deliveryEnabled: restaurant.delivery_enabled,
          pickupEnabled: restaurant.pickup_enabled,
          acceptsCash: restaurant.accepts_cash,
          acceptsCard: restaurant.accepts_card,
          acceptsTpv: restaurant.accepts_tpv,
          isOpen: restaurant.is_open,
          primaryColor: restaurant.primary_color,
          accentColor: restaurant.accent_color,
          textColor: restaurant.text_color,
        }}
      />
    </div>
  );
}
