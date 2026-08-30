import { NextResponse, type NextRequest } from 'next/server';
import { getTableByCode } from '@/lib/queries/public';
import { tableCookieName } from '@/lib/table-session';
import { BROWSE_COOKIE } from '@/lib/store-context';
import { originFromRequest } from '@/lib/request-url';

/**
 * Punto de entrada de los QR de mesa.
 *
 * Guarda el código en una cookie propia del restaurante y redirige a su carta:
 * a partir de ahí el cliente navega con normalidad y la app sabe en todo
 * momento desde qué mesa está pidiendo.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const found = await getTableByCode(code);

  // El origen sale de las cabeceras del proxy, no de request.url: si no,
  // el QR escaneado en el móvil acabaría redirigiendo a localhost.
  const origin = originFromRequest(request);

  if (!found) {
    return NextResponse.redirect(new URL('/?error=table_not_found', origin));
  }

  const { table, restaurant } = found;
  const response = NextResponse.redirect(new URL(`/r/${restaurant.slug}`, origin));

  // Quien escanea el QR está sentado en el local: su Yumi es este restaurante,
  // no el escaparate. Se limpia cualquier rastro de navegación previa.
  response.cookies.set(BROWSE_COOKIE, 'store', {
    path: '/',
    maxAge: 60 * 60 * 6,
    sameSite: 'lax',
  });

  response.cookies.set(tableCookieName(restaurant.slug), table.code, {
    path: '/',
    maxAge: 60 * 60 * 6, // una sobremesa larga
    sameSite: 'lax',
    httpOnly: false, // el cliente la lee para mostrar el nombre de la mesa
  });

  return response;
}
