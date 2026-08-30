import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getPublicOrigin } from '@/lib/request-url';
import { getBrand } from '@/lib/brand';
import { sendMail } from '@/lib/mailer';
import { passwordResetEmail } from '@/lib/emails/password-reset';

export type ResetResult = { ok: true } | { ok: false; error: string };

/**
 * Envía un enlace para restablecer la contraseña.
 *
 * El enlace lo genera la API de administración de Supabase, pero **lo manda
 * esta aplicación por su propio SMTP**: el de GoTrue no está configurado en
 * este despliegue y sus correos no salen, así que dejarlo en sus manos
 * significaría que nadie recupera nunca su cuenta.
 *
 * Del enlace que devuelve Supabase sólo se aprovecha el token: se descarta su
 * `action_link`, que apunta a `/auth/v1/verify` y acaba devolviendo al usuario
 * al dominio de la base de datos. GoTrue sólo respeta un `redirect_to` que esté
 * en su lista blanca y, si no lo está, lo cambia en silencio por su `SITE_URL`,
 * de modo que el enlace del correo llevaba a Supabase en vez de a esta
 * aplicación y allí no había ninguna pantalla donde escribir la contraseña.
 * Apuntando directamente aquí y canjeando el token en la propia página, el
 * correo funciona sin tocar la configuración del despliegue de Supabase.
 *
 * Devuelve `ok` aunque el correo no exista, para no revelar qué direcciones
 * están registradas.
 */
export async function sendPasswordResetFor(email: string): Promise<ResetResult> {
  const target = email.trim().toLowerCase();
  if (!target.includes('@')) return { ok: false, error: 'INVALID_EMAIL' };

  let admin: ReturnType<typeof createAdminSupabase>;
  try {
    admin = createAdminSupabase();
  } catch {
    return { ok: false, error: 'SERVICE_ROLE_MISSING' };
  }

  const origin = (await getPublicOrigin()).replace(/\/$/, '');

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: target,
    options: { redirectTo: `${origin}/reset-password` },
  });

  // Correo desconocido: se responde igual que si existiera.
  if (error || !data?.properties?.hashed_token) {
    return { ok: true };
  }

  const brand = await getBrand();
  const message = passwordResetEmail({
    appName: brand.appName,
    brandColor: brand.primaryColor,
    link: `${origin}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`,
  });

  const sent = await sendMail({ to: target, ...message });
  if (!sent.ok) return { ok: false, error: sent.error };

  return { ok: true };
}
