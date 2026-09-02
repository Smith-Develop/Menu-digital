import 'server-only';
import type {
  Autenticacion,
  Codificacion,
  Contexto,
  Peticion,
  Receta,
  ResultadoCobro,
} from './tipos';
import { extraer, rellenar } from './plantilla';

/**
 * El intérprete de recetas.
 *
 * Ejecuta lo que dice la receta de una pasarela y devuelve lo que hemos pedido
 * que saque de la respuesta. Se programa una vez; a partir de ahí, conectar una
 * pasarela nueva es escribir datos en un formulario.
 *
 * Vive en la aplicación y no en la base de datos a propósito: una llamada HTTP
 * dentro de una transacción deja la base esperando a un servidor ajeno, y un
 * servidor ajeno que no contesta es la mitad de los días.
 */

const TIEMPO_LIMITE = 20_000;

/** Lo que pasó en la llamada, para poder discutirlo con el proveedor. */
export type Traza = {
  url: string;
  method: string;
  status: number;
  ms: number;
  respuesta: unknown;
};

async function llamar(
  peticion: Peticion,
  contexto: Contexto,
  cabecerasBase: Record<string, string>,
  codificacionPorDefecto: Codificacion,
): Promise<{ datos: unknown; traza: Traza }> {
  const url = rellenar(peticion.url, contexto);
  const metodo = peticion.method ?? 'POST';
  const codificacion = peticion.encoding ?? codificacionPorDefecto;

  const cabeceras: Record<string, string> = {
    ...cabecerasBase,
    ...rellenar(peticion.headers ?? {}, contexto),
  };

  let cuerpo: string | undefined;
  if (peticion.body !== undefined && metodo !== 'GET') {
    const relleno = rellenar(peticion.body, contexto);
    if (codificacion === 'form') {
      // Stripe y algunas más esperan el cuerpo como formulario, no como JSON.
      cabeceras['Content-Type'] = 'application/x-www-form-urlencoded';
      cuerpo = new URLSearchParams(aplanar(relleno)).toString();
    } else {
      cabeceras['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(relleno);
    }
  }

  const inicio = Date.now();
  const respuesta = await fetch(url, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo,
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });

  const texto = await respuesta.text();
  let datos: unknown = texto;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // Hay pasarelas que devuelven texto plano cuando algo va mal. Se guarda tal
    // cual: el mensaje del error suele estar ahí.
  }

  return {
    datos,
    traza: {
      url,
      method: metodo,
      status: respuesta.status,
      ms: Date.now() - inicio,
      respuesta: datos,
    },
  };
}

/**
 * Aplana un objeto al formato de formulario que usa Stripe: `a[b][c]=valor`.
 */
function aplanar(valor: unknown, prefijo = ''): Record<string, string> {
  if (valor === null || valor === undefined) return {};
  if (typeof valor !== 'object') return { [prefijo]: String(valor) };

  const salida: Record<string, string> = {};
  for (const [clave, hijo] of Object.entries(valor as Record<string, unknown>)) {
    const nombre = prefijo ? `${prefijo}[${clave}]` : clave;
    Object.assign(salida, aplanar(hijo, nombre));
  }
  return salida;
}

/** Construye las cabeceras de autenticación, pidiendo un testigo si hace falta. */
async function autenticar(
  auth: Autenticacion | undefined,
  contexto: Contexto,
): Promise<Record<string, string>> {
  if (!auth || auth.mode === 'none') return {};

  if (auth.mode === 'bearer') {
    return { Authorization: `Bearer ${rellenar(auth.token, contexto)}` };
  }

  if (auth.mode === 'basic') {
    const par = `${rellenar(auth.user, contexto)}:${rellenar(auth.password, contexto)}`;
    return { Authorization: `Basic ${Buffer.from(par).toString('base64')}` };
  }

  if (auth.mode === 'header') {
    return { [auth.header]: rellenar(auth.value, contexto) };
  }

  // OAuth2: se pide un testigo con las credenciales y se usa en la de verdad.
  const par = `${rellenar(auth.client_id, contexto)}:${rellenar(auth.client_secret, contexto)}`;
  const respuesta = await fetch(rellenar(auth.url, contexto), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(par).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      ...(auth.scope ? { scope: auth.scope } : {}),
    }).toString(),
    signal: AbortSignal.timeout(TIEMPO_LIMITE),
  });

  const datos = await respuesta.json().catch(() => null);
  const testigo = extraer(datos, auth.token_path ?? '$.access_token');
  if (!testigo) throw new Error('OAUTH_SIN_TESTIGO');

  return { Authorization: `Bearer ${String(testigo)}` };
}

/** Ejecuta un paso de la receta y saca de la respuesta lo que pide `extract`. */
export async function ejecutar(
  receta: Receta,
  paso: Peticion,
  contexto: Contexto,
): Promise<{ valores: Record<string, unknown>; traza: Traza; ok: boolean }> {
  const cabeceras = await autenticar(receta.auth, contexto);
  const { datos, traza } = await llamar(paso, contexto, cabeceras, receta.encoding ?? 'json');

  const valores: Record<string, unknown> = {};
  for (const [nombre, camino] of Object.entries(paso.extract ?? {})) {
    valores[nombre] = extraer(datos, camino);
  }

  return { valores, traza, ok: traza.status >= 200 && traza.status < 300 };
}

/** Abre un cobro en la pasarela y devuelve a dónde mandar al cliente. */
export async function abrirCobro(receta: Receta, contexto: Contexto): Promise<ResultadoCobro> {
  try {
    const { valores, traza, ok } = await ejecutar(receta, receta.create, contexto);

    if (!ok) {
      return { ok: false, raw: traza, error: `HTTP_${traza.status}` };
    }

    const redirect = valores.redirect_url;
    const referencia = valores.reference;

    if (!redirect || typeof redirect !== 'string') {
      // La llamada fue bien pero no encontramos la dirección donde dijimos que
      // estaría: la receta apunta a un camino equivocado. Es un fallo de
      // configuración y hay que decirlo así, no como «error de la pasarela».
      return { ok: false, raw: traza, error: 'RECETA_SIN_REDIRECCION' };
    }

    return {
      ok: true,
      redirect_url: redirect,
      reference: referencia === undefined || referencia === null ? undefined : String(referencia),
      raw: traza,
    };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'ERROR';
    return { ok: false, raw: { error: mensaje }, error: mensaje };
  }
}
