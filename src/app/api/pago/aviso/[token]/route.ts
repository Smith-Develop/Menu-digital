import { NextResponse, type NextRequest } from 'next/server';
import { procesarAviso } from '@/lib/payments';

/** La firma se calcula sobre el cuerpo tal y como llegó, sin volver a serializar. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El aviso de la pasarela.
 *
 * Cada comercio tiene su propio trozo de dirección, así que el aviso llega ya
 * identificado y sólo hay que comprobar una firma en vez de probarlas todas.
 *
 * Se contesta 200 incluso a lo que no se entiende, salvo cuando la firma no
 * cuadra. Un proveedor que recibe un error reintenta durante horas, y la
 * mayoría de las veces el motivo no es suyo sino nuestro: un aviso repetido, un
 * estado intermedio, un pedido que ya estaba cobrado. Una firma inválida sí es
 * asunto suyo —o de alguien haciéndose pasar por él— y merece un 400.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const cuerpo = await request.text();

  const cabeceras: Record<string, string> = {};
  request.headers.forEach((valor, clave) => {
    cabeceras[clave.toLowerCase()] = valor;
  });

  const resultado = await procesarAviso(token, cuerpo, cabeceras);

  if (!resultado.ok && resultado.error?.startsWith('FIRMA_INVALIDA')) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  if (!resultado.ok && resultado.error === 'METODO_DESCONOCIDO') {
    return NextResponse.json({ error: resultado.error }, { status: 404 });
  }

  return NextResponse.json({ recibido: true, estado: resultado.estado ?? resultado.error });
}
