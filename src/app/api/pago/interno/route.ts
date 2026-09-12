import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { originFromRequest } from '@/lib/request-url';
import { cobrarEnLinea, guardarTarjetaDelCliente, type Instruccion } from '@/lib/payments/inline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cobrar sin salir de la aplicación.
 *
 * Lo que llega aquí no es una tarjeta. Es un testigo de un solo uso que el
 * navegador consiguió hablando directamente con la pasarela, y que sólo sirve
 * para esta operación y para el comercio que lo pidió. El número de la tarjeta
 * no ha pasado ni pasará por este servidor.
 *
 * Quien paga puede no tener cuenta: en el escaparate se pide sin registrarse, y
 * para ese caso vale el testigo del pedido, que es lo mismo que le permite ver
 * su seguimiento y que nadie más conoce.
 */
export async function POST(request: NextRequest) {
  const cuerpo = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    methodId?: string;
    token?: string;
    instruccion?: Instruccion;
    /** Un segundo testigo, sólo para dejar la tarjeta guardada. */
    tokenParaGuardar?: string;
  };

  if (!cuerpo.orderId || !cuerpo.methodId || !cuerpo.instruccion) {
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
    if (!cuerpo.token) return NextResponse.json({ error: 'SIN_TESTIGO' }, { status: 401 });

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

  // PSE pide la dirección de quien paga para su control de fraude. Detrás de un
  // proxy la de la conexión es la del proxy, así que se busca antes la que
  // reenvía, que es la del cliente de verdad.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    undefined;

  const resultado = await cobrarEnLinea(
    intentId,
    originFromRequest(request).replace(/\/$/, ''),
    cuerpo.instruccion,
    ip,
  );

  if ('error' in resultado) {
    return NextResponse.json({ error: resultado.error, intentId }, { status: 502 });
  }

  /*
   * Guardar la tarjeta va después del cobro y en su propio hilo.
   *
   * Si falla, el pedido ya está pagado y no hay ningún motivo para contárselo
   * al cliente en ese momento: se enterará la próxima vez, cuando no la vea en
   * la lista, y volverá a teclearla. Contarlo ahora sólo sembraría la duda de
   * si el pago ha ido bien.
   */
  if (user && cuerpo.tokenParaGuardar && resultado.estado === 'paid') {
    const { data: perfil } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .maybeSingle();
    void guardarTarjetaDelCliente(
      cuerpo.methodId,
      user.id,
      perfil?.email ?? user.email ?? '',
      cuerpo.tokenParaGuardar,
    );
  }

  return NextResponse.json(resultado);
}
