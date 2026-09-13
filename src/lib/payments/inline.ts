import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { currencyDecimals } from '@/lib/money';
import { importeMayor } from './plantilla';
import { cargarMetodo } from './metodo';
import * as mercadopago from './proveedores/mercadopago';

/**
 * Cobrar sin sacar al cliente de la aplicación.
 *
 * El intérprete de recetas de `motor.ts` cubre las pasarelas que devuelven una
 * dirección a la que redirigir. Esto es el otro camino: la pasarela nos da un
 * testigo desde el navegador y el cobro se hace aquí, de servidor a servidor,
 * sin que el cliente se mueva de la pantalla donde estaba.
 *
 * Qué pasarela sabe hacerlo lo dice su columna `inline`; cómo se hace, el
 * adaptador de cada una. Son los únicos dos sitios que hay que tocar para que
 * entre la siguiente.
 */

export type Instruccion =
  | {
      tipo: 'card';
      token: string;
      metodoTarjeta: string;
      cuotas?: number;
      documento?: { tipo: string; numero: string } | null;
      /** Un segundo testigo, pedido sólo para dejarla guardada. */
      tokenParaGuardar?: string | null;
    }
  | {
      tipo: 'saved_card';
      tarjetaId: string;
      token: string;
      metodoTarjeta: string;
      cuotas?: number;
    }
  | {
      tipo: 'pse';
      banco: string;
      tipoPersona: 'individual' | 'association';
      nombre: string;
      documento: { tipo: string; numero: string };
    };

export type RespuestaCobro = {
  ok: boolean;
  estado: 'paid' | 'pending' | 'failed' | 'cancelled';
  /** A dónde mandar al cliente. PSE acaba siempre en la web de su banco. */
  redirect?: string;
  motivo?: string;
  intentId: string;
};

export async function cobrarEnLinea(
  intentId: string,
  origen: string,
  instruccion: Instruccion,
  ip?: string,
): Promise<RespuestaCobro | { error: string }> {
  const supabase = createAdminSupabase();

  const { data: intento } = await supabase
    .from('payment_intents')
    .select('*')
    .eq('id', intentId)
    .maybeSingle();
  if (!intento) return { error: 'INTENT_NOT_FOUND' };
  if (!intento.method_id) return { error: 'METHOD_NOT_SET' };
  if (intento.status === 'paid') return { error: 'ORDER_ALREADY_PAID' };

  const { data: pedido } = await supabase
    .from('orders')
    .select('code, customer_name, customer_email')
    .eq('id', intento.order_id)
    .maybeSingle();
  if (!pedido) return { error: 'ORDER_NOT_FOUND' };

  const { metodo, proveedor, credenciales } = await cargarMetodo(intento.method_id);

  if (proveedor.slug !== 'mercadopago' || !proveedor.inline) {
    return { error: `SIN_COBRO_INTERNO:${proveedor.slug}` };
  }

  const decimales = currencyDecimals(intento.currency);
  const comun = {
    importeMayor: Number(importeMayor(intento.amount_cents, decimales)),
    descripcion: `Pedido ${pedido.code}`,
    referenciaExterna: intento.id,
    avisoUrl: `${origen}/api/pago/aviso/${metodo.webhook_token}`,
    // Mercado Pago exige un correo del pagador. Quien pide sin dar el suyo
    // sigue pudiendo pagar: se usa uno del propio pedido, que existe siempre.
    correo: pedido.customer_email || `pedido-${pedido.code}@yumi.app`,
  };

  let resultado: mercadopago.Resultado;

  if (instruccion.tipo === 'pse') {
    resultado = await mercadopago.cobrarConPse(credenciales, {
      ...comun,
      documento: instruccion.documento,
      banco: instruccion.banco,
      tipoPersona: instruccion.tipoPersona,
      nombre: instruccion.nombre || pedido.customer_name || 'Cliente',
      volverA: `${origen}/pago/${intento.id}`,
      ip,
    });
  } else if (instruccion.tipo === 'saved_card') {
    // La tarjeta guardada pertenece a un cliente de *ese* comercio en la
    // pasarela, y hay que decir cuál: sin eso, el testigo hecho desde una
    // tarjeta guardada no vale.
    const { data: tarjeta } = await supabase
      .from('payment_cards')
      .select('id, customer_id, payment_customers!inner(provider_customer_id, user_id)')
      .eq('id', instruccion.tarjetaId)
      .maybeSingle();

    const duenyo = (tarjeta as { payment_customers?: { provider_customer_id: string } } | null)
      ?.payment_customers;
    if (!duenyo) return { error: 'CARD_NOT_FOUND' };

    resultado = await mercadopago.cobrarConTarjeta(credenciales, {
      ...comun,
      token: instruccion.token,
      metodoTarjeta: instruccion.metodoTarjeta,
      cuotas: instruccion.cuotas ?? 1,
      clienteProveedor: duenyo.provider_customer_id,
    });
  } else {
    resultado = await mercadopago.cobrarConTarjeta(credenciales, {
      ...comun,
      token: instruccion.token,
      metodoTarjeta: instruccion.metodoTarjeta,
      cuotas: instruccion.cuotas ?? 1,
      documento: instruccion.documento,
    });
  }

  /*
   * Se apunta el resultado aunque haya salido mal.
   *
   * Un intento fallido que no deja rastro es lo que convierte «me cobraron y no
   * llegó el pedido» en una discusión sin datos. Con el apunte, la referencia
   * de la pasarela está ahí para preguntarle a ella.
   */
  const { error } = await supabase.rpc('settle_payment_intent', {
    p_intent_id: intentId,
    p_status: resultado.estado,
    p_provider_ref: resultado.referencia ?? null,
    p_raw: (resultado.crudo ?? null) as never,
    p_fee_cents: resultado.comision
      ? Math.round(resultado.comision * 10 ** decimales)
      : 0,
  });
  if (error && resultado.estado === 'paid') return { error: error.message };

  // El porqué, en el propio intento. `settle_payment_intent` guarda la
  // respuesta cruda, que es la prueba, pero el motivo en claro es lo que
  // permite ver de un vistazo si al comercio le fallan las llaves.
  /*
   * Y lo que la pasarela acaba de declarar sobre sí misma.
   *
   * `live_mode` es la única fuente que no se equivoca sobre si estas llaves
   * mueven dinero de verdad: el prefijo de la llave ya no lo distingue, porque
   * Mercado Pago emite credenciales de prueba que empiezan igual que las
   * reales. Se anota en cuanto se sabe, salga bien el cobro o salga mal.
   */
  if (typeof resultado.enVivo === 'boolean') {
    await supabase.rpc('record_live_mode', {
      p_method_id: intento.method_id,
      p_live: resultado.enVivo,
    });
  }

  if (resultado.motivo) {
    await supabase
      .from('payment_intents')
      .update({ error_code: resultado.motivo })
      .eq('id', intentId);
  }

  return {
    ok: resultado.ok,
    estado: resultado.estado,
    redirect: resultado.redirect,
    motivo: resultado.motivo,
    intentId,
  };
}

/**
 * Deja la tarjeta guardada para la próxima vez.
 *
 * Va aparte del cobro a propósito: si esto falla, el pedido ya está pagado y no
 * hay ningún motivo para molestar al cliente con ello. Se le dirá la próxima
 * vez, cuando no vea su tarjeta en la lista.
 */
export async function guardarTarjetaDelCliente(
  methodId: string,
  userId: string,
  correo: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminSupabase();
  const { metodo, proveedor, credenciales } = await cargarMetodo(methodId);

  if (proveedor.slug !== 'mercadopago') return { ok: false, error: 'SIN_GUARDADO' };

  const guardada = await mercadopago.guardarTarjeta(credenciales, correo, token);
  if (!guardada.ok || !guardada.tarjeta || !guardada.clienteProveedor) {
    return { ok: false, error: guardada.error ?? 'TARJETA_NO_GUARDADA' };
  }

  const { data: cliente } = await supabase
    .from('payment_customers')
    .upsert(
      {
        restaurant_id: metodo.restaurant_id,
        provider_id: proveedor.id,
        user_id: userId,
        provider_customer_id: guardada.clienteProveedor,
      },
      { onConflict: 'restaurant_id,provider_id,user_id' },
    )
    .select('id')
    .maybeSingle();
  if (!cliente) return { ok: false, error: 'CLIENTE_NO_GUARDADO' };

  const { error } = await supabase.from('payment_cards').upsert(
    {
      customer_id: cliente.id,
      provider_card_id: guardada.tarjeta.id,
      brand: guardada.tarjeta.marca,
      last_four: guardada.tarjeta.ultimos,
      exp_month: guardada.tarjeta.mes,
      exp_year: guardada.tarjeta.anyo,
      holder_name: guardada.tarjeta.titular,
    },
    { onConflict: 'customer_id,provider_card_id' },
  );

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Lo que el formulario necesita y no es nuestro: los bancos de PSE del día y
 * los tipos de documento del país. Se piden a la vez porque se pintan a la vez.
 */
export async function datosDePago(
  methodId: string,
): Promise<{ bancos: { id: string; nombre: string }[]; documentos: { id: string; nombre: string }[] }> {
  const { proveedor, credenciales } = await cargarMetodo(methodId);
  if (proveedor.slug !== 'mercadopago') return { bancos: [], documentos: [] };

  const [bancos, documentos] = await Promise.all([
    mercadopago.bancosPse(credenciales),
    mercadopago.tiposDeDocumento(credenciales),
  ]);
  return { bancos, documentos };
}

/** Quita la tarjeta aquí y en la pasarela. */
export async function olvidarTarjeta(
  tarjetaId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminSupabase();

  const { data: fila } = await supabase
    .from('payment_cards')
    .select('id, provider_card_id, payment_customers!inner(id, user_id, provider_customer_id, restaurant_id, provider_id)')
    .eq('id', tarjetaId)
    .maybeSingle();

  const duenyo = (
    fila as {
      payment_customers?: {
        user_id: string;
        provider_customer_id: string;
        restaurant_id: string;
        provider_id: string;
      };
    } | null
  )?.payment_customers;
  if (!fila || !duenyo) return { ok: false, error: 'CARD_NOT_FOUND' };
  // La política ya lo impediría desde el navegador, pero aquí se entra con la
  // llave de servicio, que las salta todas.
  if (duenyo.user_id !== userId) return { ok: false, error: 'CARD_NOT_YOURS' };

  const { data: metodo } = await supabase
    .from('merchant_payment_methods')
    .select('id')
    .eq('restaurant_id', duenyo.restaurant_id)
    .eq('provider_id', duenyo.provider_id)
    .maybeSingle();

  if (metodo) {
    const { proveedor, credenciales } = await cargarMetodo(metodo.id);
    if (proveedor.slug === 'mercadopago') {
      await mercadopago.borrarTarjeta(credenciales, duenyo.provider_customer_id, fila.provider_card_id);
    }
  }

  // Se borra la nuestra aunque la baja en la pasarela falle: lo que el cliente
  // pidió es dejar de verla y no poder volver a usarla desde aquí.
  const { error } = await supabase.from('payment_cards').delete().eq('id', tarjetaId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
