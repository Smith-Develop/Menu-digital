import { notFound } from 'next/navigation';
import { requireStaffContext } from '@/lib/auth';
import { canAccessSection } from '@/lib/auth-permissions';
import { createServerSupabase } from '@/lib/supabase/server';
import { getPublicOrigin } from '@/lib/request-url';
import {
  MerchantPayments,
  type Campo,
  type PasarelaDisponible,
} from '@/components/dashboard/merchant-payments';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Formas de cobro' };

export default async function PaymentsPage() {
  const { restaurant, staffRole } = await requireStaffContext();
  if (!canAccessSection('payments', staffRole)) notFound();

  const supabase = await createServerSupabase();
  const [{ data: proveedores }, { data: metodos }] = await Promise.all([
    supabase
      .from('payment_providers')
      .select('id, slug, name, kind, countries, currencies, config_schema')
      .eq('is_active', true)
      .eq('kind', 'online')
      .order('position'),
    supabase
      .from('merchant_payment_methods')
      .select('id, provider_id, is_active, secret_id, webhook_token')
      .eq('restaurant_id', restaurant.id),
  ]);

  const origen = await getPublicOrigin();
  const porProveedor = new Map((metodos ?? []).map((m) => [m.provider_id, m]));

  /*
   * Sólo se ofrece lo que de verdad puede cobrar aquí. Una pasarela que no
   * opera en el país del local, o que no acepta su divisa, no es una opción:
   * es una tarde perdida averiguando por qué no funciona. Lista vacía en el
   * proveedor quiere decir «en todas partes».
   */
  // El país puede no estar puesto en locales antiguos; entonces se ofrece todo
  // y que lo decida quien lo configura, en vez de esconderlo sin explicación.
  const pais = restaurant.country ?? '';
  const sirve = (paises: string[], divisas: string[]) =>
    (paises.length === 0 || !pais || paises.includes(pais)) &&
    (divisas.length === 0 || divisas.includes(restaurant.currency));

  const pasarelas: PasarelaDisponible[] = (proveedores ?? [])
    .filter((p) => sirve(p.countries, p.currencies))
    .map((p) => {
      const mio = porProveedor.get(p.id);
      return {
        providerId: p.id,
        slug: p.slug,
        name: p.name,
        campos: ((p.config_schema ?? []) as Campo[]) ?? [],
        methodId: mio?.id ?? null,
        activa: mio?.is_active ?? false,
        tieneLlaves: Boolean(mio?.secret_id),
        webhookUrl: mio ? `${origen}/api/pago/aviso/${mio.webhook_token}` : null,
      };
    });

  return <MerchantPayments pasarelas={pasarelas} pais={pais || '—'} />;
}
