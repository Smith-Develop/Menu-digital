import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { currencyDecimals } from '@/lib/money';
import { abrirCobro } from './motor';
import { importeMayor } from './plantilla';
import type { Contexto, Receta } from './tipos';
import { entornoDeLasLlaves } from './proveedores/mercadopago';

/**
 * Abre una operación de mentira contra la pasarela para ver si contesta.
 *
 * No crea pedido, ni intento, ni apunte: una preferencia o un enlace de pago
 * que nadie va a abrir no mueve dinero y caduca solo. Lo que sí demuestra es lo
 * que hace falta demostrar antes de vender: que las credenciales del comercio
 * valen y que la receta encaja con lo que el proveedor espera recibir.
 */
export async function probarPasarela(
  methodId: string,
  origen: string,
): Promise<
  | { ok: true; host: string; entorno: 'prueba' | 'produccion' | null }
  | { ok: false; error: string }
> {
  const supabase = createAdminSupabase();

  const { data: metodo } = await supabase
    .from('merchant_payment_methods')
    .select('id, restaurant_id, provider_id, settings, webhook_token')
    .eq('id', methodId)
    .maybeSingle();
  if (!metodo) return { ok: false, error: 'METHOD_NOT_FOUND' };

  const { data: proveedor } = await supabase
    .from('payment_providers')
    .select('slug, adapter, spec')
    .eq('id', metodo.provider_id)
    .maybeSingle();
  if (!proveedor) return { ok: false, error: 'PROVIDER_NOT_FOUND' };
  if (proveedor.adapter !== 'http') {
    return { ok: false, error: `ADAPTADOR_NO_IMPLEMENTADO:${proveedor.adapter}` };
  }

  const { data: local } = await supabase
    .from('restaurants')
    .select('currency, name')
    .eq('id', metodo.restaurant_id)
    .maybeSingle();
  const divisa = local?.currency ?? 'EUR';
  const decimales = currencyDecimals(divisa);

  const { data: credenciales } = await supabase.rpc('merchant_credentials', {
    p_method_id: methodId,
  });
  if (!credenciales || Object.keys(credenciales as object).length === 0) {
    return { ok: false, error: 'SIN_CREDENCIALES' };
  }

  /*
   * Antes de gastar una llamada: que las llaves no se contradigan entre sí.
   *
   * Mezclar las de prueba con las de producción es el error más fácil de
   * cometer —se copian de dos pestañas distintas del mismo panel— y el más
   * caro de descubrir, porque no falla al guardar sino delante de un cliente.
   */
  let entorno: 'prueba' | 'produccion' | null = null;
  if (proveedor.slug === 'mercadopago') {
    const revision = entornoDeLasLlaves(credenciales as Record<string, string>);
    if (!revision.ok) return { ok: false, error: revision.error };
    entorno = revision.entorno;
  }

  // Un importe pequeño pero por encima del mínimo que aceptan casi todas: un
  // importe de cero lo rechazan y el error se confundiría con credenciales malas.
  const minimo = 10 ** decimales * (decimales === 0 ? 1000 : 1);

  const contexto: Contexto = {
    ...(credenciales as Record<string, string>),
    ...((metodo.settings ?? {}) as Record<string, string>),
    amount_minor: minimo,
    amount_major: Number(importeMayor(minimo, decimales)),
    amount_major_text: importeMayor(minimo, decimales),
    currency: divisa,
    order_code: 'PRUEBA',
    order_id: '00000000-0000-0000-0000-000000000000',
    intent_id: '00000000-0000-0000-0000-000000000000',
    description: `Prueba de conexión · ${local?.name ?? ''}`.trim(),
    return_url: `${origen}/dashboard/payments`,
    cancel_url: `${origen}/dashboard/payments`,
    webhook_url: `${origen}/api/pago/aviso/${metodo.webhook_token}`,
    customer_name: 'Prueba',
    customer_email: '',
    customer_phone: '',
    reference: '',
  };

  const resultado = await abrirCobro((proveedor.spec ?? {}) as unknown as Receta, contexto);

  if (!resultado.ok || !resultado.redirect_url) {
    return { ok: false, error: resultado.error ?? 'SIN_RESPUESTA' };
  }

  try {
    return { ok: true, host: new URL(resultado.redirect_url).host, entorno };
  } catch {
    return { ok: true, host: resultado.redirect_url.slice(0, 40), entorno };
  }
}
