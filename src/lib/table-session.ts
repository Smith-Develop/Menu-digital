import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createPublicSupabase } from '@/lib/supabase/server';

/**
 * Contexto de mesa.
 *
 * Cuando alguien escanea el QR guardamos en una cookie el código de la mesa y
 * el turno que tenía en ese momento, para que pueda navegar por la carta sin
 * arrastrar el código en cada URL y sin perder el modo "estoy sentado en la
 * mesa 7".
 *
 * El turno es lo que le pone fin. Al cobrar la cuenta la mesa estrena turno, de
 * modo que la cookie del comensal anterior deja de valer y la aplicación vuelve
 * a comportarse como una tienda a domicilio. Sin esto, quien había comido en el
 * local seguía viendo el carrito de mesa desde su casa días después.
 */
export function tableCookieName(slug: string): string {
  return `mdt_${slug}`;
}

/** Lo que se guarda en la cookie: código y turno, separados por un punto. */
export function tableCookieValue(code: string, sessionId: string): string {
  return `${code}.${sessionId}`;
}

/**
 * Código de mesa vigente para ese restaurante, o null si el turno ya cerró.
 *
 * `cache` evita repetir la comprobación en cada componente de una misma
 * pantalla: la carta la consulta varias veces por petición.
 */
export const getTableCodeFor = cache(async (slug: string): Promise<string | null> => {
  const store = await cookies();
  const raw = store.get(tableCookieName(slug))?.value;
  if (!raw) return null;

  const separador = raw.lastIndexOf('.');

  // Cookies de antes de existir el turno: no traen sesión y ya no valen. Se
  // ignoran en lugar de darlas por buenas, que es el comportamiento que
  // dejaba a la gente atrapada en una mesa.
  if (separador < 0) return null;

  const code = raw.slice(0, separador);
  const sessionId = raw.slice(separador + 1);
  if (!code || !sessionId) return null;

  try {
    const supabase = createPublicSupabase();
    const { data } = await supabase.rpc('table_session_alive', {
      p_code: code,
      p_session: sessionId,
    });
    return data ? code : null;
  } catch {
    // Si la comprobación no se puede hacer, se prefiere el modo tienda: es el
    // que funciona en cualquier caso, mientras que quedarse en mesa por error
    // impide pedir a domicilio.
    return null;
  }
});
