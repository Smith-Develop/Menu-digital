import { notFound } from 'next/navigation';
import { requireStaffContext } from '@/lib/auth';
import { canAccessSection } from '@/lib/auth-permissions';
import { createServerSupabase } from '@/lib/supabase/server';
import { entornoDelMetodo } from '@/lib/payments/entorno';
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

  const pais = restaurant.country ?? '';

  const supabase = await createServerSupabase();
  const [{ data: proveedores }, { data: metodos }, { data: ofrecidas }] = await Promise.all([
    supabase
      .from('payment_providers')
      .select('id, slug, name, kind, countries, currencies, config_schema, inline')
      .eq('is_active', true)
      .eq('kind', 'online')
      .order('position'),
    supabase
      .from('merchant_payment_methods')
      .select('id, provider_id, is_active, secret_id, webhook_token')
      .eq('restaurant_id', restaurant.id),
    // Qué ofrece la plataforma en este país. Es una decisión de negocio que
    // toma el superadministrador, distinta de dónde opera cada pasarela.
    pais
      ? supabase.from('country_payment_providers').select('provider_id').eq('country', pais)
      : Promise.resolve({ data: [] as { provider_id: string }[] }),
  ]);

  // Tener llaves es que las llaves existan. Preguntar por el identificador del
  // secreto decía que sí aunque el secreto ya no estuviera, y entonces la
  // pantalla prometía una forma de cobro que fallaba al usarla.
  const { data: conLlaves } = await supabase.rpc('merchant_methods_ready', {
    p_restaurant_id: restaurant.id,
  });
  const listos = new Set((conLlaves as string[] | null) ?? []);

  const origen = await getPublicOrigin();
  const porProveedor = new Map((metodos ?? []).map((m) => [m.provider_id, m]));

  /*
   * Sólo se ofrece lo que de verdad puede cobrar aquí. Una pasarela que no está
   * ofrecida en su país, o que no acepta su divisa, no es una opción: es una
   * tarde perdida averiguando por qué no funciona.
   *
   * Un local sin país —de los antiguos— las ve todas: esconderlas sin
   * explicación sería peor que ofrecer alguna de más.
   */
  const enEstePais = new Set((ofrecidas ?? []).map((o) => o.provider_id));
  const sirve = (id: string, divisas: string[]) =>
    (!pais || enEstePais.has(id)) &&
    (divisas.length === 0 || divisas.includes(restaurant.currency));

  /*
   * En qué entorno están las llaves de cada método, y qué ha fallado hoy.
   *
   * Las dos cosas existen por el mismo motivo: mientras un comercio tiene mal
   * configurado el cobro, sus clientes reciben errores y él no se entera de
   * nada. Aquí se entera.
   */
  const configurados = (metodos ?? []).filter((m) => listos.has(m.id));

  const [entornos, { data: fallos }] = await Promise.all([
    Promise.all(
      configurados.map(async (m) => [m.id, await entornoDelMetodo(m.id)] as const),
    ),
    supabase
      .from('payment_intents')
      .select('method_id, error_code, created_at')
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false }),
  ]);

  const porEntorno = new Map(entornos);
  const ultimoFallo = new Map<string, { motivo: string; cuando: string; veces: number }>();
  for (const f of fallos ?? []) {
    if (!f.method_id || !f.error_code) continue;
    const ya = ultimoFallo.get(f.method_id);
    if (ya) ya.veces += 1;
    else ultimoFallo.set(f.method_id, { motivo: f.error_code, cuando: f.created_at, veces: 1 });
  }

  const pasarelas: PasarelaDisponible[] = (proveedores ?? [])
    .filter((p) => sirve(p.id, p.currencies))
    .map((p) => {
      const mio = porProveedor.get(p.id);
      return {
        providerId: p.id,
        slug: p.slug,
        name: p.name,
        campos: ((p.config_schema ?? []) as Campo[]) ?? [],
        methodId: mio?.id ?? null,
        activa: mio?.is_active ?? false,
        tieneLlaves: mio ? listos.has(mio.id) : false,
        webhookUrl: mio ? `${origen}/api/pago/aviso/${mio.webhook_token}` : null,
        // De qué campo sale la clave que permite cobrar dentro de la tienda.
        // Sin ella la pasarela sigue cobrando, pero sacando al cliente fuera, y
        // eso el comercio tiene que saberlo antes y no descubrirlo después.
        campoClavePublica:
          (p.inline as { public_field?: string } | null)?.public_field ?? null,
        entorno: mio ? (porEntorno.get(mio.id) ?? null) : null,
        ultimoFallo: mio ? (ultimoFallo.get(mio.id) ?? null) : null,
      };
    });

  return <MerchantPayments pasarelas={pasarelas} pais={pais || '—'} />;
}
