import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { entornoDeLasLlaves } from './proveedores/mercadopago';

export type Entorno = 'prueba' | 'produccion' | null;

/**
 * En qué entorno están las llaves que el comercio tiene guardadas.
 *
 * Existe por un caso real que costó tres intentos y una tarde. El panel de
 * Mercado Pago enseña por defecto las credenciales de **producción**, y hay que
 * cambiar de pestaña para ver las de prueba. Quien copia las que tiene delante
 * copia las reales, las guarda, pulsa «probar la conexión» —que da bien, porque
 * las credenciales de producción son perfectamente válidas— y después descubre
 * que ninguna tarjeta de prueba funciona, con un error que no lo explica.
 *
 * Decirlo en la propia ficha convierte ese descubrimiento en una etiqueta.
 *
 * Las credenciales se leen con la llave de servicio y no salen de aquí: lo
 * único que se devuelve es en qué entorno están, que no es un secreto.
 */
export async function entornoDelMetodo(methodId: string): Promise<Entorno> {
  const supabase = createAdminSupabase();

  const { data: metodo } = await supabase
    .from('merchant_payment_methods')
    .select('provider_id')
    .eq('id', methodId)
    .maybeSingle();
  if (!metodo) return null;

  const { data: proveedor } = await supabase
    .from('payment_providers')
    .select('slug')
    .eq('id', metodo.provider_id)
    .maybeSingle();
  // Sólo Mercado Pago distingue los dos entornos en el propio prefijo de la
  // llave. Cuando entre otra que lo haga, aquí se añade su adaptador.
  if (proveedor?.slug !== 'mercadopago') return null;

  const { data: credenciales } = await supabase.rpc('merchant_credentials', {
    p_method_id: methodId,
  });
  if (!credenciales) return null;

  const resultado = entornoDeLasLlaves(credenciales as Record<string, string>);
  return resultado.ok ? resultado.entorno : null;
}
