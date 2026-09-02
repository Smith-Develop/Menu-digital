import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { originFromRequest } from '@/lib/request-url';
import { iniciarCobro } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Arranca un cobro en línea y devuelve a dónde mandar al cliente.
 *
 * Quien paga puede no tener cuenta: en el escaparate se pide sin registrarse.
 * Para ese caso vale el testigo del pedido, que es lo mismo que le permite ver
 * su propio seguimiento y que nadie más conoce. Con sesión se usa la sesión, y
 * es la base quien decide si esa persona puede pagar ese pedido.
 */
export async function POST(request: NextRequest) {
  const cuerpo = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    methodId?: string;
    token?: string;
  };

  if (!cuerpo.orderId || !cuerpo.methodId) {
    return NextResponse.json({ error: 'FALTAN_DATOS' }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let intentId: string;

  if (user) {
    const { data, error } = await supabase.rpc('create_payment_intent', {
      p_order_id: cuerpo.orderId,
      p_method_id: cuerpo.methodId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    intentId = (data as { intent_id: string }).intent_id;
  } else {
    if (!cuerpo.token) {
      return NextResponse.json({ error: 'SIN_TESTIGO' }, { status: 401 });
    }

    // Sin sesión, el testigo es la prueba. Se comprueba contra el pedido antes
    // de usar la llave de servicio, que salta todas las políticas.
    const admin = createAdminSupabase();
    const { data: pedido } = await admin
      .from('orders')
      .select('id')
      .eq('id', cuerpo.orderId)
      .eq('public_token', cuerpo.token)
      .maybeSingle();
    if (!pedido) return NextResponse.json({ error: 'TESTIGO_INVALIDO' }, { status: 403 });

    const { data, error } = await admin.rpc('create_payment_intent', {
      p_order_id: cuerpo.orderId,
      p_method_id: cuerpo.methodId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    intentId = (data as { intent_id: string }).intent_id;
  }

  const resultado = await iniciarCobro(intentId, originFromRequest(request).replace(/\/$/, ''));

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error, intentId }, { status: 502 });
  }
  return NextResponse.json({ url: resultado.url, intentId });
}
