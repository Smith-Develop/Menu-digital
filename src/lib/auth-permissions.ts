import type { Enums } from '@/types/database';

/**
 * Permisos por rol de equipo. Vive aparte de lib/auth.ts porque ese módulo
 * importa APIs de servidor y estos helpers también se usan en el cliente.
 */
const MANAGE_MENU: Enums<'staff_role'>[] = ['owner', 'admin', 'manager'];

export function canManageMenu(role: Enums<'staff_role'>): boolean {
  return MANAGE_MENU.includes(role);
}

export function canManageStaff(role: Enums<'staff_role'>): boolean {
  return role === 'owner' || role === 'admin';
}

export function canManageBilling(role: Enums<'staff_role'>): boolean {
  return role === 'owner';
}

export function canWorkKitchen(role: Enums<'staff_role'>): boolean {
  return ['owner', 'admin', 'manager', 'kitchen'].includes(role);
}

/**
 * Qué secciones del panel puede abrir cada rol.
 *
 * La base de datos ya impide que un camarero guarde la ficha del restaurante,
 * pero la interfaz se lo ofrecía igualmente: entraba en Ajustes, rellenaba el
 * formulario y el guardado no hacía nada. Definir aquí el acceso permite cerrar
 * la puerta antes, y que el menú lateral enseñe sólo lo que cada uno usa.
 *
 * Esto es comodidad y claridad, no la barrera de seguridad: esa son las
 * políticas de la base de datos y las comprobaciones de las acciones.
 */
const TODOS: Enums<'staff_role'>[] = ['owner', 'admin', 'manager', 'waiter', 'kitchen', 'cashier'];

export const DASHBOARD_SECTIONS = {
  overview: TODOS,
  orders: TODOS,
  // La caja la abre y la cierra quien cobra. La cocina no la ve.
  cash: ['owner', 'admin', 'manager', 'cashier', 'waiter'],
  // La sala es el sitio del camarero: mesas, quién las atiende y sus avisos.
  floor: ['owner', 'admin', 'manager', 'waiter'],
  kitchen: ['owner', 'admin', 'manager', 'kitchen'],
  menu: ['owner', 'admin', 'manager'],
  tables: ['owner', 'admin', 'manager'],
  banners: ['owner', 'admin', 'manager'],
  coupons: ['owner', 'admin', 'manager'],
  couriers: ['owner', 'admin', 'manager'],
  staff: ['owner', 'admin'],
  settings: ['owner', 'admin'],
  subscription: ['owner'],
} satisfies Record<string, Enums<'staff_role'>[]>;

export type DashboardSection = keyof typeof DASHBOARD_SECTIONS;

export function canAccessSection(section: DashboardSection, role: Enums<'staff_role'>): boolean {
  return (DASHBOARD_SECTIONS[section] as readonly Enums<'staff_role'>[]).includes(role);
}

/** Ajustes del restaurante: sólo quien responde del negocio. */
export function canManageSettings(role: Enums<'staff_role'>): boolean {
  return canAccessSection('settings', role);
}

/**
 * Quién puede cobrar una cuenta.
 *
 * Cobrar mueve dinero y hasta ahora lo podía hacer cualquiera con sesión de
 * equipo, cocina incluida. Se deja en manos de quien atiende al cliente o
 * lleva la caja; la cocina no toca el dinero.
 *
 * Estas dos listas tienen su gemela en la base de datos (`can_charge` y
 * `can_cancel_orders`, migración 0035). Aquí sirven para no ofrecer botones
 * que la base va a rechazar; la barrera de verdad es la de allí.
 */
export function canChargeOrders(role: Enums<'staff_role'>): boolean {
  return ['owner', 'admin', 'manager', 'cashier', 'waiter'].includes(role);
}

/**
 * Quién puede anular un pedido.
 *
 * Más restrictivo que cobrar: anular borra una venta de las cuentas del día,
 * así que responde quien dirige el local. La misma lista gobierna todo lo que
 * reduce la venta —devolver dinero, anular una línea, invitar a un plato—,
 * porque son la misma decisión con distinta forma.
 */
export function canCancelOrders(role: Enums<'staff_role'>): boolean {
  return ['owner', 'admin', 'manager'].includes(role);
}

/** Devolver dinero, anular líneas e invitar: quien responde de la caja. */
export const canRefund = canCancelOrders;
export const canVoidItems = canCancelOrders;
export const canDiscount = canCancelOrders;
