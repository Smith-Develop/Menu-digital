import { requireStaffContext, daysUntil, subscriptionIsLive } from '@/lib/auth';
import { getI18n } from '@/i18n';
import { DashboardShell } from '@/components/dashboard/shell';
import { StaffAlerts } from '@/components/dashboard/staff-alerts';
import { resolveSounds, type SoundSettings } from '@/lib/sounds';
import { createServerSupabase } from '@/lib/supabase/server';
import { PrintProvider } from '@/components/dashboard/print/print-provider';
import {
  DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
} from '@/components/dashboard/print/ticket';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, restaurant, staffRole, subscription } = await requireStaffContext();

  const supabase = await createServerSupabase();
  const { data: platform } = await supabase
    .from('app_settings')
    .select('sound_settings')
    .eq('id', true)
    .maybeSingle();
  const sounds: SoundSettings = resolveSounds(
    platform?.sound_settings as Partial<SoundSettings> | null,
    restaurant.sound_settings as Partial<SoundSettings> | null,
  );
  const { t } = await getI18n();

  const remaining = subscription ? daysUntil(subscription.current_period_end) : null;
  const live = subscriptionIsLive(subscription);

  // Los ajustes de impresión llegan como jsonb: se completan con los valores
  // por defecto para que un campo añadido después no rompa paneles antiguos.
  const printSettings: PrintSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    ...((restaurant.print_settings as Partial<PrintSettings> | null) ?? {}),
  };

  return (
    <PrintProvider
      restaurant={{
        name: restaurant.name,
        address: restaurant.address,
        phone: restaurant.phone,
        logoUrl: restaurant.logo_url,
        // Sin identificación fiscal del emisor, lo impreso no es un ticket:
        // es un resumen de la comanda.
        taxId: restaurant.document_number,
      }}
      settings={printSettings}
    >
    <DashboardShell
      restaurant={{
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        logoUrl: restaurant.logo_url,
        isOpen: restaurant.is_open,
      }}
      user={{ name: profile.full_name ?? profile.email ?? '', avatar: profile.avatar_url }}
      staffRole={staffRole}
      isSuperadmin={profile.role === 'superadmin'}
      subscriptionBanner={
        !live
          ? { tone: 'danger', message: t.subscription.expiredWarning }
          : remaining !== null && remaining <= 7
            ? { tone: 'warning', message: t.subscription.expiringWarning }
            : null
      }
    >
      {/* Los avisos de mesa se ven en cualquier pantalla del panel, no sólo en
          la comanda: quien esté editando la carta también tiene que enterarse. */}
      <StaffAlerts
        restaurantId={restaurant.id}
        sounds={sounds}
        onlyMyTables={staffRole === 'waiter'}
        userId={profile.id}
      />

      {children}
    </DashboardShell>
    </PrintProvider>
  );
}
