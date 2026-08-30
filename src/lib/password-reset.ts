import 'server-only';
import { createAdminSupabase } from '@/lib/supabase/server';
import { env } from '@/lib/env';
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
  if (error || !data?.properties?.action_link) {
    return { ok: true };
  }

  const brand = await getBrand();
  const message = passwordResetEmail({
    appName: brand.appName,
    brandColor: brand.primaryColor,
    link: toPublicAuthLink(data.properties.action_link),
  });

  const sent = await sendMail({ to: target, ...message });
  if (!sent.ok) return { ok: false, error: sent.error };

  return { ok: true };
}

/**
 * Reescribe el enlace de verificación con la URL pública de Supabase.
 *
 * GoTrue construye el enlace con la dirección que tiene configurada, y en un
 * despliegue con Docker esa suele ser la interna (`http://supabase-kong:8000`),
 * que no resuelve desde el móvil de nadie. Se cambia el origen por el que la
 * aplicación ya usa para hablar con Supabase, dejando intactos el token y los
 * parámetros de redirección.
 */
function toPublicAuthLink(link: string): string {
  try {
    const original = new URL(link);
    const publicBase = new URL(env.supabaseUrl);

    // Asignar `host` no borra el puerto anterior: hay que limpiarlo aparte,
    // o el enlace acabaría apuntando al dominio público con el puerto interno.
    original.protocol = publicBase.protocol;
    original.hostname = publicBase.hostname;
    original.port = publicBase.port;
    return original.toString();
  } catch {
    return link;
  }
}
