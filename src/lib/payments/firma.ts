import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Contexto, Verificacion } from './tipos';
import { rellenar } from './plantilla';

/**
 * ¿Es este aviso de quien dice ser?
 *
 * Un webhook es una dirección pública: cualquiera puede llamarla diciendo que
 * un pedido está pagado. Lo único que separa un cobro real de uno inventado es
 * esta comprobación, así que se hace antes de mirar nada más del cuerpo.
 *
 * La comparación es de tiempo constante. Comparar firmas con `===` filtra, por
 * lo que tarda en fallar, cuántos caracteres iniciales acertaste, y eso permite
 * adivinar una firma byte a byte.
 */
export function verificarFirma(
  verificacion: Verificacion,
  cuerpoCrudo: string,
  cabeceras: Record<string, string>,
  credenciales: Record<string, string>,
): { ok: boolean; motivo?: string } {
  if (!verificacion || verificacion.mode === 'none') {
    return { ok: true };
  }

  if (verificacion.mode === 'fetch_back') {
    // Este modo no se resuelve con matemáticas sino con otra llamada, y esa la
    // hace el motor porque necesita salir a la red.
    return { ok: true, motivo: 'consulta_de_vuelta' };
  }

  const contexto = { ...credenciales, cuerpo: cuerpoCrudo } as unknown as Contexto;
  const secreto = rellenar(verificacion.secret, contexto);
  if (!secreto) return { ok: false, motivo: 'sin secreto configurado' };

  const recibida = cabeceras[verificacion.header.toLowerCase()];
  if (!recibida) return { ok: false, motivo: `falta la cabecera ${verificacion.header}` };

  const limpia = verificacion.prefix
    ? recibida.replace(verificacion.prefix, '').trim()
    : recibida.trim();

  const firmado = verificacion.template
    ? rellenar(verificacion.template, contexto)
    : cuerpoCrudo;

  const algoritmo = verificacion.mode === 'hmac_sha512' ? 'sha512' : 'sha256';
  const codificacion = verificacion.encoding ?? 'hex';
  const calculada = createHmac(algoritmo, secreto).update(firmado, 'utf8').digest(codificacion);

  const a = Buffer.from(calculada);
  const b = Buffer.from(limpia);
  if (a.length !== b.length) return { ok: false, motivo: 'la firma no cuadra' };

  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, motivo: 'la firma no cuadra' };
}
