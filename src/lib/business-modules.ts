import type { Enums } from '@/types/database';

/**
 * Qué módulos tiene encendidos cada tipo de negocio.
 *
 * Gemela de la tabla `business_modules` de la migración 0049. Está repetida aquí
 * por lo mismo que `canChargeOrders` repite `can_charge`: la interfaz decide qué
 * enseñar mientras dibuja, y no puede esperar a preguntárselo a la base en cada
 * enlace del menú. La barrera de verdad sigue estando allí —un supermercado no
 * puede levantar un pedido en mesa aunque alguien invente la URL—; esto sólo
 * evita ofrecer puertas que no llevan a ninguna parte.
 *
 * Si se añade un vertical, se añade en los dos sitios. Son quince líneas y se
 * ven de un vistazo; una consulta por enlace no lo compensaba.
 */
const MODULOS: Record<Enums<'business_type'>, Record<string, boolean>> = {
  restaurant: {
    kitchen: true,
    tables: true,
    floor: true,
    picking: false,
    slots: false,
    barcodes: false,
  },
  grocery: {
    kitchen: false,
    tables: false,
    floor: false,
    picking: true,
    slots: true,
    barcodes: true,
  },
};

export type BusinessModule = keyof (typeof MODULOS)['restaurant'];

/**
 * Un módulo que nadie ha declarado está encendido.
 *
 * Vender, cobrar, cuadrar la caja y repartir son de los dos, y no hace falta
 * enumerarlos: lo que se declara es lo que se apaga.
 */
export function hasModule(businessType: Enums<'business_type'>, module: string): boolean {
  return MODULOS[businessType]?.[module] ?? true;
}

/** El nombre que recibe preparar un pedido en cada negocio. */
export function isGrocery(businessType: Enums<'business_type'>): boolean {
  return businessType === 'grocery';
}

/**
 * Precio por unidad de medida, con su etiqueta.
 *
 * Es lo que permite comparar dos formatos del mismo producto —y lo que la ley
 * suele exigir enseñar junto al precio— pero sólo tiene sentido cuando el
 * envase declara cuánto lleva dentro. Sin contenido, no se enseña nada: un
 * "0,00 € el kilo" es peor que el silencio.
 *
 * Los gramos y los mililitros se llevan al kilo y al litro, que es como se
 * compara en una estantería. La misma cuenta que hace `unit_price_cents` en la
 * base: aquí se repite para no pedir una consulta por producto de la rejilla.
 */
export function unitPrice(
  priceCents: number,
  unit: string,
  netContent: number | null,
): { cents: number; unit: 'kg' | 'l' | 'unit' } | null {
  if (!netContent || netContent <= 0) return null;

  if (unit === 'g') return { cents: Math.round(priceCents / (netContent / 1000)), unit: 'kg' };
  if (unit === 'ml') return { cents: Math.round(priceCents / (netContent / 1000)), unit: 'l' };
  if (unit === 'kg') return { cents: Math.round(priceCents / netContent), unit: 'kg' };
  if (unit === 'l') return { cents: Math.round(priceCents / netContent), unit: 'l' };
  return null;
}
