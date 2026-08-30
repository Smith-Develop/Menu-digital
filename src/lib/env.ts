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
  password: process.env.SMTP_PASSWORD ?? '',
  from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '',
  fromName: process.env.SMTP_FROM_NAME ?? 'Yumi',
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
