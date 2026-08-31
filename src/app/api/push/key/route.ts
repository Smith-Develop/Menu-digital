import { NextResponse } from 'next/server';
import { pushEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Clave pública de los avisos push.
 *
 * Se sirve desde aquí en lugar de incrustarla al compilar. Las variables
 * `NEXT_PUBLIC_*` se resuelven en tiempo de compilación: si no estaban
 * definidas en ese momento —lo normal cuando se añaden al despliegue después—
 * el navegador recibe un valor vacío para siempre y los avisos quedan
 * inservibles aunque el servidor tenga las claves. Pedirla en tiempo de
 * ejecución hace que basta con reiniciar, sin recompilar.
 *
 * Es pública por definición: es lo que identifica a este servidor ante el
 * servicio de push del fabricante. La privada nunca sale de aquí.
 */
export async function GET() {
  if (!pushEnv.isConfigured) {
    // Se dicen los nombres de las variables que faltan, nunca sus valores: es
    // lo que convierte un "no funciona" en algo que se puede arreglar sin
    // entrar a mirar el código.
    const faltan = [
      !pushEnv.publicKey && 'VAPID_PUBLIC_KEY',
      !pushEnv.privateKey && 'VAPID_PRIVATE_KEY',
    ].filter(Boolean);

    return NextResponse.json({ key: null, missing: faltan });
  }

  return NextResponse.json({ key: pushEnv.publicKey });
}
