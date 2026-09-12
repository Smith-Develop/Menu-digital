import { notFound } from 'next/navigation';
import { createAdminSupabase } from '@/lib/supabase/server';
import { PaymentReturn } from '@/components/storefront/payment-return';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pago' };

/**
 * La vuelta de la pasarela.
 *
 * Quien llega aquí acaba de pagar —o de cancelar— en otra web, y lo único que
 * quiere saber es si su pedido está bien. El aviso de la pasarela puede tardar
 * unos segundos en llegar, así que la pantalla espera y va mirando, en vez de
 * dar por bueno lo que diga la dirección de vuelta: la dirección la controla el
 * navegador y no prueba nada.
 */
export default async function PagoPage({
  params,
  searchParams,
}: {
  params: Promise<{ intento: string }>;
  searchParams: Promise<{ cancelado?: string }>;
}) {
  const { intento } = await params;
  const { cancelado } = await searchParams;

  // Con la llave de servicio porque quien paga puede no tener cuenta; lo que se
  // devuelve es sólo lo suyo y nada reservado.
  const supabase = createAdminSupabase();
  const { data } = await supabase
    .from('payment_intents')
    .select('id, order_id, status, amount_cents, currency')
    .eq('id', intento)
    .maybeSingle();

  if (!data) notFound();

  const { data: pedido } = await supabase
    .from('orders')
    .select('code, public_token')
    .eq('id', data.order_id)
    .maybeSingle();

  return (
    <PaymentReturn
      intentId={data.id}
      estado={data.status}
      amountCents={data.amount_cents}
      currency={data.currency}
      orderCode={pedido?.code ?? ''}
      orderToken={pedido?.public_token ?? ''}
      cancelado={cancelado === '1'}
    />
  );
}
