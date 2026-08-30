function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Message = { subject: string; html: string; text: string };

function shell(brandColor: string, appName: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF7F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px -12px rgba(26,24,23,0.18);">
        <tr><td style="padding:32px 32px 8px;text-align:center;">
          <div style="display:inline-block;width:52px;height:52px;line-height:52px;border-radius:15px;background:${escapeHtml(brandColor)};color:#fff;font-size:22px;font-weight:700;">
            ${escapeHtml(appName.charAt(0))}
          </div>
          <h1 style="margin:18px 0 0;font-size:21px;line-height:1.3;color:#1A1817;font-weight:700;">${escapeHtml(title)}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 32px;">${body}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#B0A9A2;">${escapeHtml(appName)}</p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Avisos de cambio de correo.
 *
 * Se manda uno a cada dirección: a la anterior porque es la única forma de que
 * el titular se entere si el cambio no lo pidió él, y a la nueva para que sepa
 * con qué cuenta entra desde ahora.
 */
export function emailChangedNotice({
  appName,
  brandColor,
  fullName,
  previousEmail,
  newEmail,
}: {
  appName: string;
  brandColor: string;
  fullName: string;
  previousEmail: string | null;
  newEmail: string;
}): { toPrevious: Message; toNew: Message } {
  const name = fullName.split(' ')[0] || fullName;

  const toPrevious: Message = {
    subject: `Se ha cambiado el correo de tu cuenta en ${appName}`,
    text: [
      `Hola ${name},`,
      '',
      `El correo de tu cuenta en ${appName} ha pasado a ser ${newEmail}.`,
      'A partir de ahora tendrás que entrar con esa dirección.',
      '',
      'Si no has sido tú, responde a este mensaje cuanto antes.',
    ].join('\n'),
    html: shell(
      brandColor,
      appName,
      'Se ha cambiado tu correo',
      `<p style="margin:0;font-size:14px;line-height:1.7;color:#403F3E;">
         Hola ${escapeHtml(name)}, el correo de tu cuenta ha pasado a ser
         <strong>${escapeHtml(newEmail)}</strong>. A partir de ahora tendrás que entrar con esa dirección.
       </p>
       <p style="margin:16px 0 0;padding:14px 16px;border-radius:12px;background:#FEF2F2;font-size:13px;line-height:1.6;color:#B91C1C;">
         Si no has sido tú, responde a este mensaje cuanto antes.
       </p>`,
    ),
  };

  const toNew: Message = {
    subject: `Tu cuenta de ${appName} usa ahora este correo`,
    text: [
      `Hola ${name},`,
      '',
      `Esta dirección es ahora la de tu cuenta en ${appName}.`,
      previousEmail ? `La anterior era ${previousEmail}.` : '',
      '',
      'Tu contraseña no ha cambiado.',
    ]
      .filter(Boolean)
      .join('\n'),
    html: shell(
      brandColor,
      appName,
      'Este es tu nuevo correo',
      `<p style="margin:0;font-size:14px;line-height:1.7;color:#403F3E;">
         Hola ${escapeHtml(name)}, esta dirección es ahora la de tu cuenta.
         ${previousEmail ? `La anterior era <strong>${escapeHtml(previousEmail)}</strong>.` : ''}
       </p>
       <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#8A837D;">
         Tu contraseña no ha cambiado.
       </p>`,
    ),
  };

  return { toPrevious, toNew };
}
