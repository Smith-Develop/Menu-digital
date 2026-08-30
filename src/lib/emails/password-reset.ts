function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Correo con el enlace para elegir una contraseña nueva. */
export function passwordResetEmail({
  appName,
  brandColor,
  link,
}: {
  appName: string;
  brandColor: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const subject = `Restablece tu contraseña de ${appName}`;

  const text = [
    `Has pedido cambiar la contraseña de tu cuenta en ${appName}.`,
    '',
    'Abre este enlace para elegir una nueva:',
    link,
    '',
    'El enlace caduca en una hora y solo se puede usar una vez.',
    'Si no lo has pedido tú, ignora este mensaje: tu contraseña no cambiará.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF7F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px -12px rgba(26,24,23,0.18);">
        <tr><td style="padding:34px 32px 8px;text-align:center;">
          <div style="display:inline-block;width:52px;height:52px;line-height:52px;border-radius:15px;background:${escapeHtml(brandColor)};color:#fff;font-size:22px;font-weight:700;">
            ${escapeHtml(appName.charAt(0))}
          </div>
          <h1 style="margin:18px 0 0;font-size:21px;color:#1A1817;font-weight:700;">Restablece tu contraseña</h1>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#676767;">
            Elige una nueva y vuelve a entrar.
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;text-align:center;">
          <a href="${escapeHtml(link)}"
             style="display:inline-block;background:${escapeHtml(brandColor)};color:#fff;text-decoration:none;
                    padding:15px 34px;border-radius:14px;font-size:15px;font-weight:700;">
            Elegir contraseña
          </a>
        </td></tr>
        <tr><td style="padding:8px 32px 30px;">
          <p style="margin:0;padding-top:16px;border-top:1px solid #E3DCD5;font-size:12px;line-height:1.7;color:#B0A9A2;text-align:center;">
            El enlace caduca en una hora y solo sirve una vez.<br>
            Si no lo has pedido tú, ignora este mensaje: tu contraseña no cambiará.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
