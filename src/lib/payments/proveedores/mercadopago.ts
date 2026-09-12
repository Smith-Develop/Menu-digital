import 'server-only';
import type { EstadoNuestro } from '../tipos';

/**
 * Mercado Pago, cobrando dentro de la aplicación.
 *
 * El intérprete de recetas cubre las pasarelas que se hablan por HTTP y
 * devuelven una dirección a la que mandar al cliente. Cobrar sin salir es otra
 * cosa y no se deja escribir como datos: hace falta un guion en el navegador
 * que cifre la tarjeta y nos devuelva un testigo. Ese guion es de la pasarela,
 * y lo que hay aquí es lo que va en el otro extremo.
 *
 * Lo importante de este fichero es lo que NO hace: no ve, no recibe y no puede
 * guardar un número de tarjeta. Lo que le llega es un testigo de un solo uso
 * que el navegador consiguió hablando directamente con Mercado Pago. Si este
 * servidor se comprometiera entero, no habría ni una tarjeta que robar.
 */
const API = 'https://api.mercadopago.com';
const TIEMPO_LIMITE = 20_000;

type Credenciales = Record<string, string>;

export type Resultado = {
  ok: boolean;
  estado: EstadoNuestro;
  referencia?: string;
  /** A dónde hay que mandar al cliente. PSE siempre acaba en la web del banco. */
  redirect?: string;
  /** Por qué se rechazó, en clave que la interfaz sabe traducir. */
  motivo?: string;
  comision?: number;
  crudo?: unknown;
};

async function llamar(
  credenciales: Credenciales,
  ruta: string,
  opciones: { method?: string; body?: unknown; idempotencia?: string } = {},
): Promise<{ ok: boolean; estado: number; datos: unknown }> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_LIMITE);

  try {
    const respuesta = await fetch(`${API}${ruta}`, {
      method: opciones.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${credenciales.access_token ?? ''}`,
        'Content-Type': 'application/json',
        // Sin esto, un reintento por una red que se cortó a mitad cobra dos
        // veces. La clave cambia con cada intento del cliente, no con el
        // pedido: quien ve su tarjeta rechazada y prueba con otra tiene que
        // poder hacerlo.
        ...(opciones.idempotencia ? { 'X-Idempotency-Key': opciones.idempotencia } : {}),
      },
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      signal: control.signal,
    });

    const texto = await respuesta.text();
    let datos: unknown = texto;
    try {
      datos = JSON.parse(texto);
    } catch {
      /* se devuelve el texto crudo, que es lo que hay que enseñar al discutir */
    }
    return { ok: respuesta.ok, estado: respuesta.status, datos };
  } catch (error) {
    return {
      ok: false,
      estado: 0,
      datos: { error: error instanceof Error ? error.message : 'SIN_RESPUESTA' },
    };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Qué significa cada estado suyo en los nuestros.
 *
 * `in_process` es el que más se olvida: la operación no está rechazada, está
 * en revisión, y puede tardar horas en resolverse. Tratarlo como fallo hace que
 * el cliente pague dos veces; tratarlo como cobrado hace que el local sirva un
 * pedido que nadie pagó. Es «pendiente», y lo resuelve el aviso posterior.
 */
export function mapearEstado(suyo: string): EstadoNuestro {
  switch (suyo) {
    case 'approved':
      return 'paid';
    case 'authorized':
    case 'in_process':
    case 'in_mediation':
    case 'pending':
      return 'pending';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

/**
 * Por qué se rechazó, dicho de forma que el cliente pueda hacer algo.
 *
 * «Rechazada por el banco» no sirve de nada. Saber que el código de seguridad
 * está mal, o que hay que llamar al banco para autorizarla, es la diferencia
 * entre arreglarlo en diez segundos y abandonar la compra.
 */
export function motivoRechazo(detalle: string): string {
  const conocidos: Record<string, string> = {
    cc_rejected_bad_filled_card_number: 'numero',
    cc_rejected_bad_filled_date: 'caducidad',
    cc_rejected_bad_filled_security_code: 'cvv',
    cc_rejected_bad_filled_other: 'datos',
    cc_rejected_insufficient_amount: 'saldo',
    cc_rejected_high_risk: 'riesgo',
    cc_rejected_call_for_authorize: 'llamar',
    cc_rejected_card_disabled: 'inactiva',
    cc_rejected_duplicated_payment: 'duplicado',
    cc_rejected_max_attempts: 'intentos',
    cc_rejected_card_error: 'tarjeta',
    cc_rejected_blacklist: 'riesgo',
  };
  return conocidos[detalle] ?? 'generico';
}

/**
 * ¿Se contradicen las llaves entre sí?
 *
 * Mercado Pago entrega dos juegos completos, uno de prueba y otro de
 * producción, y los distingue en el propio prefijo: `TEST-` y `APP_USR-`.
 * Mezclarlos no falla al guardar —cada llave es válida por separado— sino
 * mucho después, cuando un cliente con la tarjeta en la mano recibe un
 * «Unauthorized use of live credentials» que no dice nada.
 *
 * Es barato mirarlo aquí y carísimo descubrirlo allí, así que se mira aquí.
 */
export function entornoDeLasLlaves(
  credenciales: Credenciales,
): { ok: true; entorno: 'prueba' | 'produccion' } | { ok: false; error: string } {
  const cual = (valor?: string) =>
    !valor ? null : valor.startsWith('TEST-') ? 'prueba' : valor.startsWith('APP_USR-') ? 'produccion' : null;

  const token = cual(credenciales.access_token);
  const publica = cual(credenciales.public_key);

  if (token && publica && token !== publica) return { ok: false, error: 'LLAVES_MEZCLADAS' };
  if (!token) return { ok: false, error: 'TOKEN_IRRECONOCIBLE' };
  return { ok: true, entorno: token };
}

type DatosPago = {
  importeMayor: number;
  descripcion: string;
  referenciaExterna: string;
  avisoUrl: string;
  correo: string;
  documento?: { tipo: string; numero: string } | null;
};

/** Cobra con una tarjeta: la que acaba de teclear o una que tenía guardada. */
export async function cobrarConTarjeta(
  credenciales: Credenciales,
  datos: DatosPago & {
    token: string;
    metodoTarjeta: string;
    cuotas: number;
    /** Sólo cuando se paga con una guardada: la pasarela necesita a su dueño. */
    clienteProveedor?: string | null;
  },
): Promise<Resultado> {
  const cuerpo: Record<string, unknown> = {
    transaction_amount: datos.importeMayor,
    token: datos.token,
    description: datos.descripcion,
    installments: Math.max(datos.cuotas, 1),
    payment_method_id: datos.metodoTarjeta,
    external_reference: datos.referenciaExterna,
    notification_url: datos.avisoUrl,
    payer: {
      email: datos.correo,
      ...(datos.clienteProveedor ? { id: datos.clienteProveedor, type: 'customer' } : {}),
      ...(datos.documento
        ? { identification: { type: datos.documento.tipo, number: datos.documento.numero } }
        : {}),
    },
  };

  const r = await llamar(credenciales, '/v1/payments', {
    method: 'POST',
    body: cuerpo,
    // El testigo es de un solo uso, así que identifica este intento y no otro.
    idempotencia: datos.token,
  });

  return interpretar(r);
}

/**
 * Cobra por PSE.
 *
 * Esto es lo único que no se puede meter dentro de la aplicación, y no por
 * cómo esté hecho Yumi: PSE *es* un pago desde la web del banco del cliente.
 * Lo que sí se queda dentro es elegir el banco y el tipo de documento, y volver
 * aquí al terminar en vez de quedarse en una página ajena.
 */
export async function cobrarConPse(
  credenciales: Credenciales,
  datos: DatosPago & {
    banco: string;
    tipoPersona: 'individual' | 'association';
    nombre: string;
    volverA: string;
    ip?: string;
  },
): Promise<Resultado> {
  if (!datos.documento) {
    return { ok: false, estado: 'failed', motivo: 'documento' };
  }

  const r = await llamar(credenciales, '/v1/payments', {
    method: 'POST',
    body: {
      transaction_amount: datos.importeMayor,
      description: datos.descripcion,
      payment_method_id: 'pse',
      external_reference: datos.referenciaExterna,
      notification_url: datos.avisoUrl,
      callback_url: datos.volverA,
      transaction_details: { financial_institution: datos.banco },
      additional_info: { ip_address: datos.ip ?? '127.0.0.1' },
      payer: {
        email: datos.correo,
        entity_type: datos.tipoPersona,
        first_name: datos.nombre.split(' ')[0] || datos.nombre,
        last_name: datos.nombre.split(' ').slice(1).join(' ') || datos.nombre,
        identification: { type: datos.documento.tipo, number: datos.documento.numero },
      },
    },
    idempotencia: datos.referenciaExterna,
  });

  const resultado = interpretar(r);
  const cuerpo = r.datos as { transaction_details?: { external_resource_url?: string } };
  const banco = cuerpo?.transaction_details?.external_resource_url;

  // Con PSE el pago nace pendiente y la decisión la toma el cliente en su
  // banco. Si hay a dónde ir, eso es lo que importa del resultado.
  if (banco) return { ...resultado, ok: true, estado: 'pending', redirect: banco };
  return resultado;
}

function interpretar(r: { ok: boolean; estado: number; datos: unknown }): Resultado {
  const cuerpo = r.datos as {
    id?: number | string;
    status?: string;
    status_detail?: string;
    message?: string;
    error?: string;
    fee_details?: { amount?: number }[];
  };

  /*
   * Que la pasarela nos rechace a NOSOTROS no es que rechace la tarjeta.
   *
   * Un 401 «Unauthorized use of live credentials» quiere decir que las llaves
   * del comercio están mal —normalmente mezclando las de prueba con las de
   * producción— y decirle al cliente «prueba con otra tarjeta» le hace perder
   * la tarde probando tarjetas que tampoco van a funcionar. El fallo es del
   * comercio y hay que nombrarlo como tal.
   */
  if (!r.ok) {
    if (r.estado === 401 || r.estado === 403) {
      return { ok: false, estado: 'failed', motivo: 'credenciales', crudo: r.datos };
    }
    // Una tarjeta rechazada llega con su motivo; lo demás es un problema entre
    // nuestro servidor y el suyo, y el cliente no puede hacer nada con ello.
    if (cuerpo?.status_detail?.startsWith('cc_rejected')) {
      return {
        ok: false,
        estado: 'failed',
        motivo: motivoRechazo(cuerpo.status_detail),
        crudo: r.datos,
      };
    }
    return { ok: false, estado: 'failed', motivo: 'pasarela', crudo: r.datos };
  }

  const estado = mapearEstado(cuerpo.status ?? '');
  return {
    ok: estado !== 'failed',
    estado,
    referencia: cuerpo.id !== undefined ? String(cuerpo.id) : undefined,
    motivo: estado === 'failed' ? motivoRechazo(cuerpo.status_detail ?? '') : undefined,
    comision: cuerpo.fee_details?.[0]?.amount,
    crudo: r.datos,
  };
}

/** Los bancos de PSE, tal y como los publica Mercado Pago ese día. */
export async function bancosPse(
  credenciales: Credenciales,
): Promise<{ id: string; nombre: string }[]> {
  const r = await llamar(credenciales, '/v1/payment_methods');
  if (!r.ok || !Array.isArray(r.datos)) return [];

  const pse = (r.datos as { id?: string; financial_institutions?: unknown[] }[]).find(
    (m) => m.id === 'pse',
  );
  const bancos = (pse?.financial_institutions ?? []) as { id?: string | number; description?: string }[];

  return bancos
    .filter((b) => b.id !== undefined && b.description)
    .map((b) => ({ id: String(b.id), nombre: String(b.description) }));
}

/**
 * Guarda la tarjeta para la próxima vez.
 *
 * Un testigo es de un solo uso, así que este no es el mismo con el que se
 * acaba de cobrar: el navegador pide uno aparte para guardar. Se hace después
 * de que el cobro salga bien y a propósito por separado — si guardar falla, el
 * pedido ya está pagado y eso es lo que importa.
 */
export async function guardarTarjeta(
  credenciales: Credenciales,
  correo: string,
  token: string,
): Promise<{
  ok: boolean;
  clienteProveedor?: string;
  tarjeta?: {
    id: string;
    marca: string | null;
    ultimos: string | null;
    mes: number | null;
    anyo: number | null;
    titular: string | null;
  };
  error?: string;
}> {
  const busqueda = await llamar(credenciales, `/v1/customers/search?email=${encodeURIComponent(correo)}`);
  const encontrados = (busqueda.datos as { results?: { id?: string }[] })?.results ?? [];
  let clienteId = encontrados[0]?.id;

  if (!clienteId) {
    const alta = await llamar(credenciales, '/v1/customers', {
      method: 'POST',
      body: { email: correo },
    });
    clienteId = (alta.datos as { id?: string })?.id;
    if (!clienteId) return { ok: false, error: 'CLIENTE_NO_CREADO' };
  }

  const r = await llamar(credenciales, `/v1/customers/${clienteId}/cards`, {
    method: 'POST',
    body: { token },
  });
  if (!r.ok) return { ok: false, error: 'TARJETA_NO_GUARDADA' };

  const c = r.datos as {
    id?: string;
    payment_method?: { id?: string };
    last_four_digits?: string;
    expiration_month?: number;
    expiration_year?: number;
    cardholder?: { name?: string };
  };
  if (!c.id) return { ok: false, error: 'TARJETA_NO_GUARDADA' };

  return {
    ok: true,
    clienteProveedor: clienteId,
    tarjeta: {
      id: c.id,
      marca: c.payment_method?.id ?? null,
      ultimos: c.last_four_digits ?? null,
      mes: c.expiration_month ?? null,
      anyo: c.expiration_year ?? null,
      titular: c.cardholder?.name ?? null,
    },
  };
}

/**
 * Los tipos de documento que pide el país del comercio.
 *
 * No son los mismos en Colombia —cédula, NIT, pasaporte— que en Argentina, y
 * la lista la sabe la pasarela porque depende de la cuenta con la que se
 * pregunta. Escribirla a mano aquí sería escribir la de un país y romper el
 * resto sin enterarse.
 */
export async function tiposDeDocumento(
  credenciales: Credenciales,
): Promise<{ id: string; nombre: string }[]> {
  const r = await llamar(credenciales, '/v1/identification_types');
  if (!r.ok || !Array.isArray(r.datos)) return [];
  return (r.datos as { id?: string; name?: string }[])
    .filter((d) => d.id)
    .map((d) => ({ id: String(d.id), nombre: String(d.name ?? d.id) }));
}

/** Da de baja la tarjeta también en la pasarela, no sólo aquí. */
export async function borrarTarjeta(
  credenciales: Credenciales,
  clienteProveedor: string,
  tarjeta: string,
): Promise<boolean> {
  const r = await llamar(credenciales, `/v1/customers/${clienteProveedor}/cards/${tarjeta}`, {
    method: 'DELETE',
  });
  return r.ok;
}
