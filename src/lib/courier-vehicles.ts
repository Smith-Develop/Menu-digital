/**
 * Vehículos de reparto.
 *
 * Módulo puro: lo usan tanto las acciones de servidor como el formulario de
 * alta del repartidor, que es un componente cliente y no puede importar
 * `lib/courier.ts` (ese consulta la base de datos).
 */
export const VEHICLES = ['foot', 'bike', 'moto', 'car'] as const;

export type Vehicle = (typeof VEHICLES)[number];

export function isVehicle(value: unknown): value is Vehicle {
  return typeof value === 'string' && (VEHICLES as readonly string[]).includes(value);
}
