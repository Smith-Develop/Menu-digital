import type { Contexto } from './tipos';

/**
 * Sustituye `{{nombre}}` por su valor, recorriendo todo lo que le des.
 *
 * Recorre objetos y listas porque el cuerpo de una petición es un objeto entero
 * con marcas repartidas por dentro, no una cadena suelta.
 *
 * Una marca que no existe se queda vacía en lugar de dejar el `{{…}}` escrito.
 * Mandarle a una pasarela un importe literal `{{amount_minor}}` produce un error
 * incomprensible tres pasos más allá; mandarle vacío falla donde se ve.
 */
export function rellenar<T>(plantilla: T, contexto: Contexto): T {
  if (typeof plantilla === 'string') {
    // Una marca sola conserva su tipo: `"{{amount_minor}}"` debe salir como
    // número, no como la cadena "1250", porque hay APIs que lo rechazan.
    const sola = plantilla.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (sola) {
      const valor = contexto[sola[1]];
      return (valor === undefined ? '' : valor) as unknown as T;
    }
    return plantilla.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, clave: string) => {
      const valor = contexto[clave];
      return valor === undefined ? '' : String(valor);
    }) as unknown as T;
  }

  if (Array.isArray(plantilla)) {
    return plantilla.map((v) => rellenar(v, contexto)) as unknown as T;
  }

  if (plantilla && typeof plantilla === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(plantilla)) {
      salida[clave] = rellenar(valor, contexto);
    }
    return salida as unknown as T;
  }

  return plantilla;
}

/**
 * Saca un valor de la respuesta con un camino tipo `$.datos.enlaces[0].href`.
 *
 * Es un subconjunto mínimo de JSONPath a propósito: nombre, punto e índice.
 * Con eso se lee la respuesta de cualquier pasarela que hayamos visto, y no
 * hace falta traer una biblioteca entera —ni permitir expresiones— para
 * atravesar tres niveles de un objeto.
 */
export function extraer(datos: unknown, camino: string): unknown {
  if (!camino) return undefined;

  const pasos = camino
    .replace(/^\$\.?/, '')
    .split('.')
    .flatMap((paso) => {
      const partes: (string | number)[] = [];
      const nombre = paso.replace(/\[(\d+)\]/g, (_, i: string) => {
        partes.push(Number(i));
        return '';
      });
      return nombre ? [nombre, ...partes] : partes;
    });

  let actual: unknown = datos;
  for (const paso of pasos) {
    if (actual === null || actual === undefined) return undefined;
    actual = (actual as Record<string | number, unknown>)[paso];
  }
  return actual;
}

/** El importe en unidades mayores, con punto decimal, como lo quieren las APIs. */
export function importeMayor(minorUnits: number, decimales: number): string {
  if (decimales === 0) return String(minorUnits);
  const signo = minorUnits < 0 ? '-' : '';
  const texto = String(Math.abs(minorUnits)).padStart(decimales + 1, '0');
  return `${signo}${texto.slice(0, -decimales)}.${texto.slice(-decimales)}`;
}
