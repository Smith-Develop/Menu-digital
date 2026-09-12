import { NextResponse, type NextRequest } from 'next/server';
import { datosDePago } from '@/lib/payments/inline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lo que el formulario de pago necesita saber y cambia con el tiempo.
 *
 * Los bancos de PSE entran y salen, y los tipos de documento no son los mismos
 * en Colombia que en Argentina. Traerlos en vivo de la pasarela es la
 * diferencia entre que el cliente encuentre el suyo y que se quede mirando una
 * lista que alguien escribió hace un año.
 *
 * No pide sesión porque no revela nada de nadie: son los bancos de un país y
 * los documentos que ese país usa. Lo único que necesita es el método, para
 * saber con qué credenciales preguntar.
 */
export async function GET(request: NextRequest) {
  const methodId = request.nextUrl.searchParams.get('method');
  if (!methodId) return NextResponse.json({ error: 'FALTA_METODO' }, { status: 400 });

  try {
    return NextResponse.json(await datosDePago(methodId));
  } catch {
    return NextResponse.json({ bancos: [], documentos: [] });
  }
}
