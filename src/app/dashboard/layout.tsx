import { requireStaffContext, daysUntil, subscriptionIsLive } from '@/lib/auth';
import { getI18n } from '@/i18n';
import { DashboardShell } from '@/components/dashboard/shell';
import { PrintProvider } from '@/components/dashboard/print/print-provider';
import {
  DEFAULT_PRINT_SETTINGS,
  type PrintSettings,
} from '@/components/dashboard/print/ticket';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, restaurant, staffRole, subscription } = await requireStaffContext();
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
      {children}
    </DashboardShell>
    </PrintProvider>
  );
}
