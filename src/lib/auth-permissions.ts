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
