import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { PaymentGateways, type Gateway } from '@/components/admin/payment-gateways';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pasarelas de pago' };

export default async function PaymentsPage() {
  await requireSuperadmin();
  const supabase = await createServerSupabase();

  const { data: proveedores } = await supabase
    .from('payment_providers')
    .select('*')
    .order('position')
    .order('name');

  // Cuántos comercios usa cada una: decide si se puede borrar o sólo apagar.
  const { data: metodos } = await supabase
    .from('merchant_payment_methods')
    .select('provider_id');

  const cuantos = new Map<string, number>();
  for (const m of metodos ?? []) {
    cuantos.set(m.provider_id, (cuantos.get(m.provider_id) ?? 0) + 1);
  }

  const gateways: Gateway[] = (proveedores ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    kind: p.kind,
    countries: p.countries,
    currencies: p.currencies,
    adapter: p.adapter,
    configSchema: p.config_schema,
    spec: p.spec,
    isActive: p.is_active,
    position: p.position,
    merchants: cuantos.get(p.id) ?? 0,
  }));

  return <PaymentGateways gateways={gateways} />;
}
