'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { getBrand } from '@/lib/brand';
import { sendMail } from '@/lib/mailer';
import { emailChangedNotice } from '@/lib/emails/account-notices';

export type ProfileResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

/**
 * Datos de la cuenta de un cliente.
 *
 * El correo se cambia con la clave de servicio, no desde el navegador: hay que
 * tocarlo en el sistema de autenticación y en el perfil a la vez, y sólo el
 * servidor puede hacer lo primero. Como en el resto de la plataforma, un cambio
 * de correo se avisa a la dirección vieja y a la nueva.
 */
export async function updateOwnProfile(input: unknown): Promise<ProfileResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'SIGN_IN_REQUIRED' };

  const data = parsed.data;
  const email = data.email.trim().toLowerCase();

  let service: ReturnType<typeof createAdminSupabase>;
  try {
    service = createAdminSupabase();
  } catch {
    return { ok: false, error: 'SERVICE_ROLE_MISSING' };
  }

  const { data: current } = await service
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();

  const previousEmail = current?.email ?? null;
  const emailChanged = previousEmail !== email;

  if (emailChanged) {
    const { error } = await service.auth.admin.updateUserById(user.id, {
      email,
      email_confirm: true,
    });
    if (error) {
      return {
        ok: false,
        error: /exists|registered/i.test(error.message) ? 'EMAIL_TAKEN' : error.message,
      };
    }
  }

  const { error } = await service
    .from('profiles')
    .update({
      full_name: data.fullName.trim(),
      email,
      phone: data.phone?.trim() || null,
      address: data.address?.trim() || null,
      city: data.city?.trim() || null,
      avatar_url: data.avatarUrl,
    })
    .eq('id', user.id);

  if (error) return { ok: false, error: error.message };

  if (emailChanged) {
    const brand = await getBrand();
    const notice = emailChangedNotice({
      appName: brand.appName,
      brandColor: brand.primaryColor,
      fullName: data.fullName.trim(),
      previousEmail,
      newEmail: email,
    });
    if (previousEmail) void sendMail({ to: previousEmail, ...notice.toPrevious });
    void sendMail({ to: email, ...notice.toNew });
  }

  revalidatePath('/account');
  return { ok: true };
}
