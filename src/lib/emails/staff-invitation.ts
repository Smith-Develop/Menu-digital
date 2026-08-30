import { staffRoleLabel } from '@/lib/staff-roles';
import type { Dictionary } from '@/i18n/dictionaries/es';
import type { Enums } from '@/types/database';

/** Escapa el texto que se interpola en el HTML del correo. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Correo de invitación al equipo.
 *
 * Se maqueta con tablas y estilos en línea a propósito: los clientes de correo
 * (Outlook sobre todo) ignoran hojas de estilo y buena parte de flexbox y grid.
 */
export function staffInvitationEmail({
  restaurantName,
  restaurantLogo,
  role,
  asCourier,
  inviteUrl,
  brandColor,
  appName,
  t,
}: {
  restaurantName: string;
  restaurantLogo: string | null;
  role: Enums<'staff_role'>;
  asCourier: boolean;
  inviteUrl: string;
  brandColor: string;
  appName: string;
  t: Dictionary;
}): { subject: string; html: string; text: string } {
  const roleLabel = staffRoleLabel(role, t);
  const safeRestaurant = escapeHtml(restaurantName);
  const safeRole = escapeHtml(roleLabel);
  const safeApp = escapeHtml(appName);

  const subject = `${restaurantName} te invita a su equipo en ${appName}`;

  const text = [
    `${restaurantName} te ha invitado a formar parte de su equipo en ${appName}.`,
    '',
    `Puesto: ${roleLabel}${asCourier ? ' (también repartidor)' : ''}`,
    '',
    'Abre este enlace para crear tu cuenta y entrar:',
    inviteUrl,
    '',
    'El enlace caduca en 14 días y solo sirve para este correo.',
    '',
    `Si no esperabas esta invitación, puedes ignorar este mensaje.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF7F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px -12px rgba(26,24,23,0.18);">

        <tr><td style="padding:32px 32px 24px;text-align:center;">
          ${
            restaurantLogo
              ? `<img src="${escapeHtml(restaurantLogo)}" alt="" width="64" height="64" style="width:64px;height:64px;border-radius:16px;object-fit:cover;display:block;margin:0 auto 16px;">`
              : ''
          }
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#1A1817;font-weight:700;">${safeRestaurant}</h1>
          <p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#676767;">
            te invita a formar parte de su equipo
          </p>
        </td></tr>

        <tr><td style="padding:0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F5FA;border-radius:14px;">
            <tr><td style="padding:16px 20px;text-align:center;">
              <p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8A837D;font-weight:700;">Puesto</p>
              <p style="margin:4px 0 0;font-size:17px;color:#1A1817;font-weight:700;">${safeRole}</p>
              ${
                asCourier
                  ? `<p style="margin:6px 0 0;font-size:13px;color:${escapeHtml(brandColor)};font-weight:600;">También como repartidor</p>`
                  : ''
              }
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 32px 8px;text-align:center;">
          <a href="${escapeHtml(inviteUrl)}"
             style="display:inline-block;background:${escapeHtml(brandColor)};color:#ffffff;text-decoration:none;
                    padding:15px 32px;border-radius:14px;font-size:15px;font-weight:700;">
            Crear mi cuenta y unirme
          </a>
        </td></tr>

        <tr><td style="padding:8px 32px 4px;text-align:center;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#8A837D;">
            O copia este enlace en tu navegador:
          </p>
          <p style="margin:6px 0 0;font-size:12px;line-height:1.5;word-break:break-all;">
            <a href="${escapeHtml(inviteUrl)}" style="color:${escapeHtml(brandColor)};text-decoration:none;">${escapeHtml(inviteUrl)}</a>
          </p>
        </td></tr>

        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0;padding-top:16px;border-top:1px solid #E3DCD5;font-size:12px;line-height:1.6;color:#B0A9A2;text-align:center;">
            El enlace caduca en 14 días y solo funciona con este correo.<br>
            Si no esperabas esta invitación, ignora este mensaje.
          </p>
        </td></tr>

      </table>

      <p style="margin:20px 0 0;font-size:12px;color:#B0A9A2;">${safeApp}</p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
