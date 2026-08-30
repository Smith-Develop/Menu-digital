import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { mailEnv } from '@/lib/env';

let transporter: Transporter | null = null;

/**
 * Transporte SMTP de la aplicación.
 *
 * El puerto decide el cifrado: 465 abre la conexión ya en TLS (`secure`),
 * mientras que 587 empieza en claro y sube a TLS con STARTTLS. Enviarlo al
 * revés hace que el servidor cuelgue la conexión sin explicar por qué.
 */
function getTransporter(): Transporter | null {
  if (!mailEnv.isConfigured) return null;

  transporter ??= nodemailer.createTransport({
    host: mailEnv.host,
    port: mailEnv.port,
    secure: mailEnv.port === 465,
    auth: { user: mailEnv.user, pass: mailEnv.password },
  });

  return transporter;
}

export type MailResult = { ok: true } | { ok: false; error: string };

/**
 * Envía un correo.
 *
 * Nunca lanza: quien llama suele estar completando una acción que ya ha
 * funcionado (la invitación queda creada aunque el correo falle), y un fallo
 * del servidor de correo no debe deshacerla.
 */
export async function sendMail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<MailResult> {
  const transport = getTransporter();
  if (!transport) return { ok: false, error: 'SMTP_NOT_CONFIGURED' };

  try {
    await transport.sendMail({
      from: `"${mailEnv.fromName}" <${mailEnv.from}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'SEND_FAILED',
    };
  }
}

/** Comprueba credenciales y conectividad sin mandar nada. */
export async function verifyMailer(): Promise<MailResult> {
  const transport = getTransporter();
  if (!transport) return { ok: false, error: 'SMTP_NOT_CONFIGURED' };

  try {
    await transport.verify();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'VERIFY_FAILED',
    };
  }
}
