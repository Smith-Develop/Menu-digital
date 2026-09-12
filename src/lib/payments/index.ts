import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { currencyDecimals } from '@/lib/money';
import { verificarFirma, contextoDelAviso } from './firma';
import { ejecutar } from './motor';
import { abrirCobro } from './motor';
import { importeMayor, extraer } from './plantilla';
import type { Contexto, EstadoNuestro, Receta } from './tipos';
import { cargarMetodo } from './metodo';

export type { Receta, Contexto } from './tipos';

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
    amount_major: Number(importeMayor(intento.amount_cents, decimales)),
    amount_major_text: importeMayor(intento.amount_cents, decimales),
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

  /*
   * Hay pasarelas cuyo aviso sólo dice «ha pasado algo con el pago 123» y no si
   * salió bien. Entonces se va a buscar el estado, y además conviene: llega por
   * un canal autenticado en vez de venir dentro de un mensaje que cualquiera
   * puede intentar falsificar.
   */
  let fuente: unknown = cuerpo;
  if (receta.webhook.resolve) {
    const contexto = contextoDelAviso(cuerpoCrudo, cabeceras, credenciales);
    const consulta = await ejecutar(
      receta,
      { ...receta.webhook.resolve, extract: { todo: '$' } },
      contexto as never,
    );
    if (!consulta.ok) return { ok: false, error: 'CONSULTA_FALLIDA' };
    fuente = consulta.valores.todo;
  }

  const referencia = extraer(fuente, receta.webhook.reference);
  const suyo = extraer(fuente, receta.webhook.status);
  if (!referencia) return { ok: false, error: 'AVISO_SIN_REFERENCIA' };

  const nuestro: EstadoNuestro = receta.webhook.map[String(suyo)] ?? 'pending';
  if (nuestro === 'pending') {
    // Un estado intermedio que no nos dice nada. Se responde que sí para que el
    // proveedor no lo repita eternamente, y no se toca nada.
    return { ok: true, estado: 'ignorado' };
  }

  // Algunas devuelven su propia referencia y otras la nuestra, porque se la
  // mandamos al crear la operación. La receta dice cuál de las dos es.
  const porIntento = receta.webhook.reference_is === 'intent_id';
  const { data: intento } = porIntento
    ? await supabase.from('payment_intents').select('id').eq('id', String(referencia)).maybeSingle()
    : await supabase
        .from('payment_intents')
        .select('id')
        .eq('provider_id', info.provider_id)
        .eq('provider_ref', String(referencia))
        .maybeSingle();
  if (!intento) return { ok: false, error: 'INTENTO_NO_ENCONTRADO' };

  // La comisión puede venir en unidades mayores —«1234.56»— y aquí todo se
  // guarda en la unidad menor de la divisa.
  const decimalesDivisa = currencyDecimals((await divisaDelIntento(intento.id)) ?? 'EUR');
  const bruta = receta.webhook.fee ? Number(extraer(fuente, receta.webhook.fee) ?? 0) : 0;
  const comision = receta.webhook.fee_is_major
    ? bruta * 10 ** decimalesDivisa
    : bruta;

  const { data, error } = await supabase.rpc('settle_payment_intent', {
    p_intent_id: intento.id,
    p_status: nuestro,
    // Cuando la referencia era la nuestra, se conserva la del proveedor que ya
    // teníamos: es la mitad de la clave que impide cobrar dos veces.
    p_provider_ref: porIntento ? null : String(referencia),
    p_raw: cuerpo as never,
    p_fee_cents: Number.isFinite(comision) ? Math.round(comision) : 0,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, estado: (data as { status?: string })?.status ?? nuestro };
}

/** La divisa del cobro, para saber cuántos decimales tiene su unidad menor. */
async function divisaDelIntento(intentId: string): Promise<string | null> {
  const { data } = await createAdminSupabase()
    .from('payment_intents')
    .select('currency')
    .eq('id', intentId)
    .maybeSingle();
  return data?.currency ?? null;
}
