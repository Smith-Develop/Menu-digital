/**
 * La forma de una receta de pasarela.
 *
 * Todo lo que distingue a una pasarela de otra cabe aquí: cómo se autentica,
 * qué le mandas para abrir un cobro, dónde viene la dirección a la que enviar
 * al cliente, y cómo se comprueba que el aviso posterior es suyo de verdad.
 *
 * El juego de primitivas es cerrado a propósito. Un lenguaje pequeño se puede
 * revisar de un vistazo y no se puede usar para hacer daño; uno grande acaba
 * siendo un intérprete de propósito general con las llaves de los cobros.
 */

/** De dónde salen los valores que rellenan una receta. */
export type Contexto = {
  /** El importe en la unidad menor de la divisa: 12,50 € son 1250. */
  amount_minor: number;
  /** El mismo importe en unidades mayores: "12.50". Con punto, que es lo que esperan las APIs. */
  amount_major: string;
  currency: string;
  order_code: string;
  order_id: string;
  intent_id: string;
  description: string;
  return_url: string;
  cancel_url: string;
  webhook_url: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  /** La referencia del proveedor, cuando ya la hay: para consultar o devolver. */
  reference: string;
} & Record<string, string | number>;

export type Autenticacion =
  | { mode: 'none' }
  | { mode: 'bearer'; token: string }
  | { mode: 'basic'; user: string; password: string }
  | { mode: 'header'; header: string; value: string }
  /**
   * Dos pasos: se pide un testigo con las credenciales y se usa en la llamada
   * de verdad. Es lo que necesita PayPal, y por eso está desde el principio.
   */
  | {
      mode: 'oauth2';
      url: string;
      client_id: string;
      client_secret: string;
      scope?: string;
      /** Dónde viene el testigo en la respuesta. Por defecto `$.access_token`. */
      token_path?: string;
    };

export type Codificacion = 'json' | 'form';

export type Peticion = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  encoding?: Codificacion;
  /** Qué sacar de la respuesta: nombre nuestro → camino en su JSON. */
  extract?: Record<string, string>;
};

export type Verificacion =
  | { mode: 'none' }
  | {
      mode: 'hmac_sha256' | 'hmac_sha512';
      /** La cabecera donde viene la firma. */
      header: string;
      secret: string;
      encoding?: 'hex' | 'base64';
      /**
       * Qué se firma. Por defecto el cuerpo tal cual llegó, que es lo que hacen
       * casi todos; algunos firman una cadena compuesta y para eso está esto.
       */
      template?: string;
      /** Prefijo que algunos ponen delante de la firma, como `sha256=`. */
      prefix?: string;
    }
  /**
   * No hay firma: se le vuelve a preguntar al proveedor si el aviso es suyo.
   * Es más lento y más frágil, pero es lo único que ofrecen algunos.
   */
  | { mode: 'fetch_back'; request: Peticion; expect: string; equals: string };

export type Receta = {
  auth?: Autenticacion;
  encoding?: Codificacion;
  /** Abrir el cobro. Devuelve al menos `redirect_url` y `reference`. */
  create: Peticion;
  /** Preguntar en qué estado está. Para conciliar cuando el aviso no llega. */
  status?: Peticion;
  refund?: Peticion;
  webhook?: {
    verify: Verificacion;
    /** Dónde viene, dentro del aviso, la referencia que abrimos nosotros. */
    reference: string;
    /** Dónde viene su estado. */
    status: string;
    /** Cómo se traduce su estado al nuestro. */
    map: Record<string, EstadoNuestro>;
    /** Dónde viene lo que se queda la pasarela, si lo dice. */
    fee?: string;
  };
};

export type EstadoNuestro = 'paid' | 'failed' | 'cancelled' | 'pending';

export type ResultadoCobro = {
  ok: boolean;
  redirect_url?: string;
  reference?: string;
  raw: unknown;
  error?: string;
};
