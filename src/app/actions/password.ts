'use server';

import { sendPasswordResetFor } from '@/lib/password-reset';

/**
 * Recuperación de contraseña desde la pantalla de acceso.
 *
 * Responde siempre lo mismo exista o no la cuenta: contestar distinto
 * convertiría el formulario en una forma cómoda de averiguar qué correos están
 * registrados.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean }> {
  const result = await sendPasswordResetFor(email);
  return { ok: result.ok || true };
}
