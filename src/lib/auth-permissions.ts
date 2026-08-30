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
