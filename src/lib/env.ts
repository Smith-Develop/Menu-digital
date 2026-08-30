/** Variables de entorno con validación temprana y mensajes claros. */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Cópiala desde .env.example a .env.local.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  // La clave pública VAPID viaja al navegador: es pública por diseño, es lo que
  // identifica al servidor ante el servicio de push del fabricante.
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
};

/**
 * Claves de las notificaciones push. Si faltan, la aplicación funciona igual:
 * simplemente no se ofrece activar los avisos, en vez de romperse.
 */
export const pushEnv = {
  publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
  privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  subject: process.env.VAPID_SUBJECT ?? 'mailto:noreply@nexo-app.tech',
  get isConfigured() {
    return Boolean(this.publicKey && this.privateKey);
  },
};

/** Sólo servidor: nunca debe importarse desde un componente cliente. */
export function serviceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Correo saliente de la aplicación (invitaciones de equipo y avisos).
 *
 * Ojo: NO es el que manda los correos de registro y recuperación de contraseña.
 * De esos se encarga GoTrue, el servicio de autenticación de Supabase, y sus
 * variables se configuran en el despliegue de Supabase, no aquí.
 */
export const mailEnv = {
  host: process.env.SMTP_HOST ?? '',
  port: Number(process.env.SMTP_PORT ?? 465),
  user: process.env.SMTP_USER ?? '',
  // GoTrue llama a esto SMTP_PASS y otras herramientas SMTP_PASSWORD. Como en
  // un mismo despliegue conviven ambos servicios, se aceptan los dos nombres:
  // equivocarse aquí deja el correo mudo sin dar ningún error.
  password: process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS ?? '',
  from: process.env.SMTP_FROM ?? process.env.SMTP_ADMIN_EMAIL ?? process.env.SMTP_USER ?? '',
  fromName: process.env.SMTP_FROM_NAME ?? process.env.SMTP_SENDER_NAME ?? 'Yumi',
  get isConfigured() {
    return Boolean(this.host && this.user && this.password);
  },
};

export const stripeEnv = {
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  get isConfigured() {
    return Boolean(this.secretKey);
  },
};
