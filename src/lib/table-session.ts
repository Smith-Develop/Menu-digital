import 'server-only';
import { cookies } from 'next/headers';

/**
 * Contexto de mesa.
 *
 * Cuando alguien escanea el QR guardamos el código en una cookie por
 * restaurante, para que pueda navegar por la carta sin arrastrar el código
 * en cada URL y sin perder el modo "estoy sentado en la mesa 7".
 */
export function tableCookieName(slug: string): string {
  return `mdt_${slug}`;
}

export async function getTableCodeFor(slug: string): Promise<string | null> {
  const store = await cookies();
  return store.get(tableCookieName(slug))?.value ?? null;
}
