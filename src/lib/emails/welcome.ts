import type { AccountKind } from '@/app/actions/auth';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NEXT_STEP: Record<AccountKind, { cta: string; note: string }> = {
  customer: {
    cta: 'Ver restaurantes',
    note: 'Elige tu ciudad y empieza a pedir. Podrás seguir tus pedidos en tiempo real.',
  },
  restaurant: {
    cta: 'Ir a mi panel',
    note: 'Ya tienes tu panel listo: añade tu carta, crea las mesas con su QR y empieza a recibir pedidos.',
  },
  courier: {
    cta: 'Ir a mis repartos',
    note: 'Completa tu perfil y pide a los restaurantes de tu zona que te añadan a su equipo.',
  },
};

/** Correo de bienvenida, maquetado con tablas para que Outlook lo respete. */
export function welcomeEmail({
  appName,
  tagline,
  brandColor,
  fullName,
  kind,
  url,
}: {
  appName: string;
  tagline: string;
  brandColor: string;
  fullName: string;
  kind: AccountKind;
  url: string;
}): { subject: string; html: string; text: string } {
  const step = NEXT_STEP[kind];
  const name = fullName.split(' ')[0] || fullName;

  const subject = `Te damos la bienvenida a ${appName}`;

  const text = [
    `Hola ${name},`,
    '',
    `Tu cuenta en ${appName} ya está lista.`,
    '',
    step.note,
    '',
    url,
    '',
    tagline,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF7F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px -12px rgba(26,24,23,0.18);">
        <tr><td style="padding:36px 32px 8px;text-align:center;">
          <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:16px;background:${escapeHtml(brandColor)};color:#fff;font-size:24px;font-weight:700;">
            ${escapeHtml(appName.charAt(0))}
          </div>
          <h1 style="margin:20px 0 0;font-size:24px;line-height:1.3;color:#1A1817;font-weight:700;">
            Hola ${escapeHtml(name)}
          </h1>
          <p style="margin:8px 0 0;font-size:15px;line-height:1.6;color:#676767;">
            Tu cuenta en ${escapeHtml(appName)} ya está lista.
          </p>
        </td></tr>

        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0;font-size:14px;line-height:1.7;color:#403F3E;text-align:center;">
            ${escapeHtml(step.note)}
          </p>
        </td></tr>

        <tr><td style="padding:24px 32px 32px;text-align:center;">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;background:${escapeHtml(brandColor)};color:#ffffff;text-decoration:none;
                    padding:15px 34px;border-radius:14px;font-size:15px;font-weight:700;">
            ${escapeHtml(step.cta)}
          </a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#B0A9A2;">${escapeHtml(appName)} · ${escapeHtml(tagline)}</p>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
