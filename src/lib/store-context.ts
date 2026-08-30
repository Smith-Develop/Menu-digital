import 'server-only';
import { cookies, headers } from 'next/headers';

export const BROWSE_COOKIE = 'yumi_browse';

/**
 * Cómo ha llegado el cliente a la tienda de un restaurante.
 *
 * - `marketplace`: venía navegando por Yumi, así que puede volver al escaparate
 *   y buscar otros locales.
 * - `store`: ha abierto el enlace del restaurante directamente (lo compartieron
 *   por WhatsApp, redes o un QR). Para él, Yumi *es* ese restaurante: no se le
 *   ofrece salir a ver la competencia.
 */
export type BrowseMode = 'marketplace' | 'store';

/**
 * Se decide con el `Referer`: si la petición viene de otra página del sitio que
 * no es una tienda ni un QR, el cliente estaba en el escaparate. La respuesta se
 * guarda en cookie para que siga valiendo mientras navega dentro de la tienda,
 * donde el referer ya apunta al propio restaurante.
 */
export async function getBrowseMode(): Promise<BrowseMode> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);

  const referer = headerList.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      const host = headerList.get('x-forwarded-host') ?? headerList.get('host');

      if (host && url.host === host) {
        const fromStore = url.pathname.startsWith('/r/') || url.pathname.startsWith('/m/');
        if (!fromStore) return 'marketplace';
      }
    } catch {
      // Referer ilegible: seguimos con la cookie.
    }
  }

  return cookieStore.get(BROWSE_COOKIE)?.value === 'marketplace' ? 'marketplace' : 'store';
}
