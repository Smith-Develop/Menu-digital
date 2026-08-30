'use server';

import { z } from 'zod';
import { createServerSupabase, createAdminSupabase, createPublicSupabase } from '@/lib/supabase/server';
import { getPublicOrigin } from '@/lib/request-url';
import { getBrand } from '@/lib/brand';
import { sendMail } from '@/lib/mailer';
import { welcomeEmail } from '@/lib/emails/welcome';
import { slugify } from '@/lib/utils';
import { getCurrency } from '@/lib/money';

export type AccountKind = 'customer' | 'restaurant' | 'courier';

export type SignUpResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

const baseSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
  password: z.string().min(8).max(72),
  kind: z.enum(['customer', 'restaurant', 'courier']),
  // Solo para restaurantes
  restaurantName: z.string().max(120).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  currency: z.string().length(3).optional().nullable(),
  // Solo para repartidores
  vehicle: z.enum(['foot', 'bike', 'moto', 'car']).optional().nullable(),
});

const ERRORS = {
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  RESTAURANT_NAME_REQUIRED: 'RESTAURANT_NAME_REQUIRED',
  SIGNUP_FAILED: 'SIGNUP_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

/**
 * Alta de cuenta.
 *
 * Se crea con la API de administración y el correo ya confirmado, en lugar de
 * con el registro normal, porque este despliegue de Supabase exige confirmación
 * y su GoTrue no tiene servidor de correo: el usuario quedaba creado pero sin
 * poder entrar nunca. La bienvenida la manda la propia aplicación, que sí
 * envía correo.
 *
 * Si algún día se configura el SMTP de GoTrue y se quiere verificación
 * estricta, basta con cambiar `email_confirm` a false aquí.
 */
export async function signUp(input: unknown): Promise<SignUpResult> {
  const parsed = baseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERRORS.INVALID_INPUT };

  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  if (data.kind === 'restaurant' && !data.restaurantName?.trim()) {
    return { ok: false, error: ERRORS.RESTAURANT_NAME_REQUIRED };
  }

  let admin: ReturnType<typeof createAdminSupabase>;
  try {
    admin = createAdminSupabase();
  } catch {
    // Sin clave de administración no podemos crear cuentas confirmadas.
    return { ok: false, error: 'SERVICE_ROLE_MISSING' };
  }

  const publicClient = createPublicSupabase();
  const { data: existing } = await publicClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) return { ok: false, error: ERRORS.EMAIL_TAKEN };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: data.password,
    email_confirm: true,
    user_metadata: {
      full_name: data.fullName.trim(),
      phone: data.phone?.trim() || null,
      role: data.kind === 'customer' ? 'customer' : data.kind === 'courier' ? 'courier' : 'restaurant',
    },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? '';
    return {
      ok: false,
      error: /already|registered|exists/i.test(message) ? ERRORS.EMAIL_TAKEN : ERRORS.SIGNUP_FAILED,
    };
  }

  const userId = created.user.id;

  // El trigger crea el perfil; aquí solo completamos lo que el alta aporta.
  await admin
    .from('profiles')
    .update({
      full_name: data.fullName.trim(),
      phone: data.phone?.trim() || null,
      role: data.kind === 'customer' ? 'customer' : data.kind === 'courier' ? 'courier' : 'restaurant',
    })
    .eq('id', userId);

  let redirectTo = '/';

  if (data.kind === 'restaurant') {
    const currency = getCurrency(data.currency ?? 'EUR');
    const base = slugify(data.restaurantName!) || 'restaurante';

    // Slug único: si está cogido probamos "-2", "-3"…
    let slug = base;
    for (let attempt = 2; attempt < 60; attempt += 1) {
      const { data: taken } = await admin.from('restaurants').select('id').eq('slug', slug).maybeSingle();
      if (!taken) break;
      slug = `${base}-${attempt}`;
    }

    const { error: restaurantError } = await admin.from('restaurants').insert({
      owner_id: userId,
      slug,
      name: data.restaurantName!.trim(),
      email,
      phone: data.phone?.trim() || null,
      city: data.city?.trim() || null,
      currency: currency.code,
      currency_decimals: currency.decimals,
    });

    if (restaurantError) return { ok: false, error: ERRORS.SIGNUP_FAILED };
    redirectTo = '/dashboard';
  }

  if (data.kind === 'courier') {
    await admin.from('couriers').insert({
      user_id: userId,
      phone: data.phone?.trim() || null,
      vehicle: data.vehicle ?? 'moto',
      city: data.city?.trim() || null,
    });
    redirectTo = '/courier';
  }

  // Bienvenida por el correo de la aplicación, que sí sale.
  const [origin, brand] = await Promise.all([getPublicOrigin(), getBrand()]);
  const message = welcomeEmail({
    appName: brand.appName,
    tagline: brand.tagline,
    brandColor: brand.primaryColor,
    fullName: data.fullName.trim(),
    kind: data.kind,
    url: `${origin.replace(/\/$/, '')}${redirectTo}`,
  });
  void sendMail({ to: email, ...message });

  return { ok: true, redirectTo };
}

/** Ruta de aterrizaje según lo que sea el usuario. */
export async function resolveHomeForCurrentUser(): Promise<string> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return '/';

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role === 'superadmin') return '/admin';

  const { data: owned } = await supabase
    .from('restaurants')
    .select('id')
    .eq('owner_id', user.id)
    .limit(1)
    .maybeSingle();
  if (owned) return '/dashboard';

  const { data: staff } = await supabase
    .from('restaurant_staff')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (staff) return '/dashboard';

  const { data: courier } = await supabase
    .from('couriers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (courier) return '/courier';

  return '/';
}
