import type { Enums } from '@/types/database';
import type { Dictionary } from '@/i18n/dictionaries/es';

export const STAFF_ROLES: Enums<'staff_role'>[] = [
  'owner',
  'admin',
  'manager',
  'waiter',
  'kitchen',
  'cashier',
];

/** Nombre legible del rol en el idioma activo. */
export function staffRoleLabel(role: Enums<'staff_role'>, t: Dictionary): string {
  return t.roles[role];
}
