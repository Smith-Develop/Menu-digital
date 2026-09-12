import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import type { Receta } from './tipos';

/**
 * Lo que hace falta saber para hablar con la pasarela de un comercio.
 *
 * Las credenciales se leen con la llave de servicio, nunca con la sesión de
 * quien paga ni con la del dueño del local: viven cifradas en Vault y sólo el
 * servidor las abre, un instante antes de firmar la petición.
 *
 * Vive en su propio fichero porque lo necesitan dos caminos que no se conocen
 * entre sí: el intérprete de recetas, que cobra redirigiendo, y los adaptadores
 * compilados, que cobran dentro de la aplicación.
 */
export async function cargarMetodo(methodId: string) {
  const supabase = createAdminSupabase();

  const { data: metodo } = await supabase
    .from('merchant_payment_methods')
    .select('id, restaurant_id, provider_id, settings, webhook_token')
    .eq('id', methodId)
    .maybeSingle();
  if (!metodo) throw new Error('METHOD_NOT_FOUND');

  const { data: proveedor } = await supabase
    .from('payment_providers')
    .select('id, slug, name, adapter, spec, inline')
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
