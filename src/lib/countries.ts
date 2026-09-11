/**
 * Países y ciudades.
 *
 * El país era un campo de texto de dos letras. Escribir «CO» a mano funciona
 * hasta que alguien escribe «Co», «COL» o «Colombia», y entonces el filtro de
 * pasarelas por país deja de encontrarlo y el comercio no ve ninguna forma de
 * cobro sin saber por qué. Con una lista cerrada eso no puede pasar.
 *
 * Cada país trae además su divisa y una zona horaria representativa. No para
 * imponerlas —hay locales que facturan en otra— sino para proponerlas al
 * elegir: acertar el 95% de las veces y dejar cambiarlo es mejor que preguntar
 * tres cosas que casi siempre van juntas.
 */

export type Pais = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
};

/**
 * Los tres primeros son los mercados de salida y por eso abren la lista. El
 * resto va por orden alfabético.
 */
export const PAISES: Pais[] = [
  { code: 'CO', name: 'Colombia', currency: 'COP', timezone: 'America/Bogota' },
  { code: 'HN', name: 'Honduras', currency: 'HNL', timezone: 'America/Tegucigalpa' },
  { code: 'ES', name: 'España', currency: 'EUR', timezone: 'Europe/Madrid' },

  { code: 'AR', name: 'Argentina', currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires' },
  { code: 'BO', name: 'Bolivia', currency: 'BOB', timezone: 'America/La_Paz' },
  { code: 'BR', name: 'Brasil', currency: 'BRL', timezone: 'America/Sao_Paulo' },
  { code: 'CL', name: 'Chile', currency: 'CLP', timezone: 'America/Santiago' },
  { code: 'CR', name: 'Costa Rica', currency: 'CRC', timezone: 'America/Costa_Rica' },
  { code: 'CU', name: 'Cuba', currency: 'CUP', timezone: 'America/Havana' },
  { code: 'EC', name: 'Ecuador', currency: 'USD', timezone: 'America/Guayaquil' },
  { code: 'SV', name: 'El Salvador', currency: 'USD', timezone: 'America/El_Salvador' },
  { code: 'US', name: 'Estados Unidos', currency: 'USD', timezone: 'America/New_York' },
  { code: 'GT', name: 'Guatemala', currency: 'GTQ', timezone: 'America/Guatemala' },
  { code: 'MX', name: 'México', currency: 'MXN', timezone: 'America/Mexico_City' },
  { code: 'NI', name: 'Nicaragua', currency: 'NIO', timezone: 'America/Managua' },
  { code: 'PA', name: 'Panamá', currency: 'PAB', timezone: 'America/Panama' },
  { code: 'PY', name: 'Paraguay', currency: 'PYG', timezone: 'America/Asuncion' },
  { code: 'PE', name: 'Perú', currency: 'PEN', timezone: 'America/Lima' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', timezone: 'Europe/Lisbon' },
  { code: 'PR', name: 'Puerto Rico', currency: 'USD', timezone: 'America/Puerto_Rico' },
  { code: 'DO', name: 'República Dominicana', currency: 'DOP', timezone: 'America/Santo_Domingo' },
  { code: 'UY', name: 'Uruguay', currency: 'UYU', timezone: 'America/Montevideo' },
  { code: 'VE', name: 'Venezuela', currency: 'VES', timezone: 'America/Caracas' },
];

const POR_CODIGO = new Map(PAISES.map((p) => [p.code, p]));

export function getPais(code: string | null | undefined): Pais | undefined {
  return POR_CODIGO.get((code ?? '').toUpperCase());
}

/**
 * Ciudades de los mercados de salida.
 *
 * Sólo de esos tres, y a conciencia. Una lista mundial de ciudades es un
 * proyecto propio —y estaría desactualizada— mientras que estas tres cubren a
 * todos los clientes previstos. Para el resto del mundo el campo sigue siendo
 * de texto, con la lista como sugerencia y no como reja: un local en un pueblo
 * pequeño tiene el mismo derecho a darse de alta.
 */
export const CIUDADES: Record<string, string[]> = {
  CO: [
    'Armenia', 'Barranquilla', 'Bello', 'Bogotá', 'Bucaramanga', 'Buenaventura',
    'Cali', 'Cartagena', 'Cúcuta', 'Dosquebradas', 'Envigado', 'Florencia',
    'Ibagué', 'Itagüí', 'Manizales', 'Medellín', 'Montería', 'Neiva', 'Palmira',
    'Pasto', 'Pereira', 'Popayán', 'Riohacha', 'Santa Marta', 'Sincelejo',
    'Soacha', 'Soledad', 'Tuluá', 'Tunja', 'Valledupar', 'Villavicencio', 'Yopal',
  ],
  HN: [
    'Choloma', 'Choluteca', 'Comayagua', 'Danlí', 'El Progreso', 'Juticalpa',
    'La Ceiba', 'La Lima', 'Olanchito', 'Puerto Cortés', 'Roatán', 'Santa Rosa de Copán',
    'San Pedro Sula', 'Siguatepeque', 'Tegucigalpa', 'Tela', 'Tocoa', 'Villanueva',
  ],
  ES: [
    'A Coruña', 'Albacete', 'Alicante', 'Almería', 'Badajoz', 'Barcelona',
    'Bilbao', 'Burgos', 'Cádiz', 'Cartagena', 'Castellón', 'Córdoba', 'Elche',
    'Getafe', 'Gijón', 'Girona', 'Granada', 'Huelva', 'Jaén', 'Las Palmas',
    'León', 'Lleida', 'Logroño', 'Lugo', 'Madrid', 'Málaga', 'Marbella',
    'Murcia', 'Ourense', 'Oviedo', 'Palma', 'Pamplona', 'Salamanca',
    'San Sebastián', 'Santa Cruz de Tenerife', 'Santander', 'Sevilla', 'Tarragona',
    'Toledo', 'Valencia', 'Valladolid', 'Vigo', 'Vitoria', 'Zaragoza',
  ],
};

export function ciudadesDe(code: string | null | undefined): string[] {
  return CIUDADES[(code ?? '').toUpperCase()] ?? [];
}
