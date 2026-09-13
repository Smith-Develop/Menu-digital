import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';

export type Entorno = 'prueba' | 'real' | null;

/**
 * Si las llaves de un comercio mueven dinero de verdad.
 *
 * Existe por un caso real que costó una tarde, y la primera versión de esta
 * función formaba parte del problema: deducía el entorno del prefijo de la
 * llave —`TEST-` contra `APP_USR-`— y eso ha dejado de ser cierto. El panel de
 * Mercado Pago emite hoy credenciales de prueba que empiezan por `APP_USR-`
 * igual que las reales, así que una etiqueta basada en el prefijo diría «modo
 * real» a quien tiene llaves de prueba y le mandaría a buscar el fallo donde
 * no está.
 *
 * Ahora no se deduce nada: se lee lo que la pasarela declaró en su última
 * respuesta de cobro. Mientras no haya habido ninguna, la respuesta es que no
 * se sabe, que es la verdad y se puede enseñar como tal.
 */
export async function entornoDelMetodo(methodId: string): Promise<Entorno> {
  const supabase = createAdminSupabase();

  const { data } = await supabase
    .from('merchant_payment_methods')
    .select('live_mode')
    .eq('id', methodId)
    .maybeSingle();

  if (!data || data.live_mode === null || data.live_mode === undefined) return null;
  return data.live_mode ? 'real' : 'prueba';
}
