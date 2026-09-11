import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Contexto, Verificacion } from './tipos';
import { extraer, rellenar } from './plantilla';

/**
 * Aplana un objeto a `prefijo.camino` para poder usarlo en una plantilla.
 *
 * La firma de algunas pasarelas no es sobre el cuerpo sino sobre un texto
 * compuesto con trozos del cuerpo y de las cabeceras. Para escribir ese texto
 * como plantilla hay que poder nombrarlos, y esto es lo que les da nombre.
 */
function aplanarContexto(
  valor: unknown,
  prefijo: string,
  destino: Record<string, string>,
  profundidad = 0,
): void {
  if (valor === null || valor === undefined || profundidad > 4) return;

  if (typeof valor !== 'object') {
    destino[prefijo] = String(valor);
    return;
  }
  for (const [clave, hijo] of Object.entries(valor as Record<string, unknown>)) {
    aplanarContexto(hijo, `${prefijo}.${clave}`, destino, profundidad + 1);
  }
}

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

  const recibidaCruda = cabeceras[verificacion.header.toLowerCase()];
  if (!recibidaCruda) return { ok: false, motivo: `falta la cabecera ${verificacion.header}` };

  // La cabecera puede traer varias partes: `ts=1700000000,v1=abc…`.
  const partes: Record<string, string> = {};
  let recibida = recibidaCruda.trim();

  if (verificacion.parts) {
    for (const trozo of recibidaCruda.split(verificacion.parts.separator ?? ',')) {
      const corte = trozo.indexOf('=');
      if (corte > 0) partes[trozo.slice(0, corte).trim()] = trozo.slice(corte + 1).trim();
    }
    recibida = partes[verificacion.parts.signature] ?? '';
    if (!recibida) {
      return { ok: false, motivo: `la cabecera no trae ${verificacion.parts.signature}` };
    }
  }

  if (verificacion.prefix) recibida = recibida.replace(verificacion.prefix, '').trim();

  // Todo lo que una plantilla de firma puede nombrar.
  const contexto: Record<string, string> = { ...credenciales, cuerpo: cuerpoCrudo };
  for (const [clave, valor] of Object.entries(cabeceras)) contexto[`header.${clave}`] = valor;
  for (const [clave, valor] of Object.entries(partes)) contexto[`sig.${clave}`] = valor;
  try {
    aplanarContexto(JSON.parse(cuerpoCrudo), 'body', contexto);
  } catch {
    // Un cuerpo que no es JSON no impide firmar sobre el cuerpo entero, que es
    // el caso por defecto.
  }

  const secreto = rellenar(verificacion.secret, contexto as unknown as Contexto);
  if (!secreto) return { ok: false, motivo: 'sin secreto configurado' };

  const firmado = verificacion.template
    ? rellenar(verificacion.template, contexto as unknown as Contexto)
    : cuerpoCrudo;

  const algoritmo = verificacion.mode === 'hmac_sha512' ? 'sha512' : 'sha256';
  const codificacion = verificacion.encoding ?? 'hex';
  const calculada = createHmac(algoritmo, secreto).update(firmado, 'utf8').digest(codificacion);

  const a = Buffer.from(calculada);
  const b = Buffer.from(recibida);
  if (a.length !== b.length) return { ok: false, motivo: 'la firma no cuadra' };

  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, motivo: 'la firma no cuadra' };
}

/** Lo que una plantilla puede nombrar de un aviso, para construir peticiones. */
export function contextoDelAviso(
  cuerpoCrudo: string,
  cabeceras: Record<string, string>,
  credenciales: Record<string, string>,
): Record<string, string> {
  const contexto: Record<string, string> = { ...credenciales };
  for (const [clave, valor] of Object.entries(cabeceras)) contexto[`header.${clave}`] = valor;
  try {
    aplanarContexto(JSON.parse(cuerpoCrudo), 'body', contexto);
  } catch {
    // Sin cuerpo JSON no hay nada que nombrar, y la petición de consulta
    // tendrá que apañarse con las cabeceras.
  }
  return contexto;
}

export { extraer };
