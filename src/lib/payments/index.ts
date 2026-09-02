import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { currencyDecimals } from '@/lib/money';
import { verificarFirma } from './firma';
import { abrirCobro } from './motor';
import { importeMayor, extraer } from './plantilla';
import type { Contexto, EstadoNuestro, Receta } from './tipos';

export type { Receta, Contexto } from './tipos';

/**
 * Lo que hace falta saber para hablar con la pasarela de un comercio.
 *
 * Las credenciales se leen con la llave de servicio, nunca con la sesión de
 * quien paga ni con la del dueño del local: viven cifradas en Vault y sólo el
 * servidor las abre, un instante antes de firmar la petición.
 */
async function cargarMetodo(methodId: string) {
  const supabase = createAdminSupabase();

  const { data: metodo } = await supabase
    .from('merchant_payment_methods')
    .select('id, restaurant_id, provider_id, settings, webhook_token')
    .eq('id', methodId)
    .maybeSingle();
  if (!metodo) throw new Error('METHOD_NOT_FOUND');

  const { data: proveedor } = await supabase
    .from('payment_providers')
    .select('id, slug, name, adapter, spec')
    .eq('id', metodo.provider_id)
    .maybeSingle();
  if (!proveedor) throw new Error('PROVIDER_NOT_FOUND');

  const { data: credenciales } = await supabase.rpc('merchant_credentials', {
    p_method_id: methodId,
  });

  return {
    metodo,
    proveedor,
    credenciales: (credenciales ?? {}) as Record<string, string>,
    receta: (proveedor.spec ?? {}) as unknown as Receta,
  };
}

/**
 * Arranca un cobro: llama a la pasarela y devuelve a dónde mandar al cliente.
 *
 * El intento ya existe en la base antes de llegar aquí. Así, si la pasarela no
 * contesta, queda constancia de que se intentó y con qué importe, en vez de un
 * silencio que nadie sabe interpretar tres días después.
 */
export async function iniciarCobro(
  intentId: string,
  origen: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = createAdminSupabase();

  const { data: intento } = await supabase
    .from('payment_intents')
    .select('*')
    .eq('id', intentId)
    .maybeSingle();
  if (!intento) return { ok: false, error: 'INTENT_NOT_FOUND' };
  if (!intento.method_id) return { ok: false, error: 'METHOD_NOT_SET' };

  const { data: pedido } = await supabase
    .from('orders')
    .select('code, public_token, customer_name, customer_email, customer_phone')
    .eq('id', intento.order_id)
    .maybeSingle();
  if (!pedido) return { ok: false, error: 'ORDER_NOT_FOUND' };

  let cargado;
  try {
    cargado = await cargarMetodo(intento.method_id);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'ERROR' };
  }
  const { metodo, proveedor, credenciales, receta } = cargado;

  if (proveedor.adapter !== 'http') {
    // El enganche para las que no se dejan describir con datos. Redsys será la
    // primera; hasta que exista su adaptador, decirlo claro es mejor que fallar
    // con un mensaje de la pasarela que nadie va a entender.
    return { ok: false, error: `ADAPTADOR_NO_IMPLEMENTADO:${proveedor.adapter}` };
  }

  const decimales = currencyDecimals(intento.currency);
  const contexto: Contexto = {
    ...credenciales,
    ...((metodo.settings ?? {}) as Record<string, string>),
    amount_minor: intento.amount_cents,
    amount_major: importeMayor(intento.amount_cents, decimales),
    currency: intento.currency,
    order_code: pedido.code,
    order_id: intento.order_id,
    intent_id: intento.id,
    description: `Pedido ${pedido.code}`,
    return_url: `${origen}/pago/${intento.id}`,
    cancel_url: `${origen}/pago/${intento.id}?cancelado=1`,
    webhook_url: `${origen}/api/pago/aviso/${metodo.webhook_token}`,
    customer_name: pedido.customer_name ?? '',
    customer_email: pedido.customer_email ?? '',
    customer_phone: pedido.customer_phone ?? '',
    reference: intento.provider_ref ?? '',
  };

  const resultado = await abrirCobro(receta, contexto);

  if (!resultado.ok || !resultado.redirect_url) {
    await supabase
      .from('payment_intents')
      .update({
        status: 'failed',
        error_code: resultado.error ?? 'SIN_RESPUESTA',
        raw: resultado.raw as never,
      })
      .eq('id', intentId);
    return { ok: false, error: resultado.error ?? 'SIN_RESPUESTA' };
  }

  const { error } = await supabase.rpc('mark_intent_redirected', {
    p_intent_id: intentId,
    p_provider_ref: resultado.reference ?? intentId,
    p_redirect_url: resultado.redirect_url,
    p_raw: resultado.raw as never,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, url: resultado.redirect_url };
}

/**
 * Procesa un aviso de la pasarela.
 *
 * El orden importa. Primero se averigua de qué comercio es —por el trozo de
 * dirección propio de cada método—, luego se comprueba la firma, y sólo
 * después se mira lo que dice el cuerpo. Un aviso es una dirección pública:
 * cualquiera puede llamarla diciendo que un pedido está pagado, y lo único que
 * separa un cobro real de uno inventado es esa firma.
 */
export async function procesarAviso(
  token: string,
  cuerpoCrudo: string,
  cabeceras: Record<string, string>,
): Promise<{ ok: boolean; estado?: string; error?: string }> {
  const supabase = createAdminSupabase();

  const { data: encontrado } = await supabase.rpc('method_by_webhook_token', {
    p_token: token,
  });
  const info = encontrado as {
    method_id: string;
    provider_id: string;
    spec: Receta;
    slug: string;
  } | null;
  if (!info) return { ok: false, error: 'METODO_DESCONOCIDO' };

  const { credenciales } = await cargarMetodo(info.method_id);
  const receta = info.spec ?? {};

  if (!receta.webhook) return { ok: false, error: 'RECETA_SIN_AVISO' };

  const firma = verificarFirma(receta.webhook.verify, cuerpoCrudo, cabeceras, credenciales);
  if (!firma.ok) return { ok: false, error: `FIRMA_INVALIDA:${firma.motivo}` };

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(cuerpoCrudo);
  } catch {
    return { ok: false, error: 'CUERPO_NO_JSON' };
  }

  const referencia = extraer(cuerpo, receta.webhook.reference);
  const suyo = extraer(cuerpo, receta.webhook.status);
  if (!referencia) return { ok: false, error: 'AVISO_SIN_REFERENCIA' };

  const nuestro: EstadoNuestro = receta.webhook.map[String(suyo)] ?? 'pending';
  if (nuestro === 'pending') {
    // Un estado intermedio que no nos dice nada. Se responde que sí para que el
    // proveedor no lo repita eternamente, y no se toca nada.
    return { ok: true, estado: 'ignorado' };
  }

  const { data: intento } = await supabase
    .from('payment_intents')
    .select('id')
    .eq('provider_id', info.provider_id)
    .eq('provider_ref', String(referencia))
    .maybeSingle();
  if (!intento) return { ok: false, error: 'INTENTO_NO_ENCONTRADO' };

  const comision = receta.webhook.fee ? Number(extraer(cuerpo, receta.webhook.fee) ?? 0) : 0;

  const { data, error } = await supabase.rpc('settle_payment_intent', {
    p_intent_id: intento.id,
    p_status: nuestro,
    p_provider_ref: String(referencia),
    p_raw: cuerpo as never,
    p_fee_cents: Number.isFinite(comision) ? Math.round(comision) : 0,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, estado: (data as { status?: string })?.status ?? nuestro };
}
