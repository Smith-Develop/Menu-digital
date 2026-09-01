'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils';
import { getCurrency } from '@/lib/money';

export type ActionResult = { ok: true; slug: string } | { ok: false; error: string };

/** Crea el restaurante del usuario recién registrado y le da el rol de dueño. */
export async function createRestaurant(formData: FormData): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'NOT_AUTHENTICATED' };

  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'NAME_REQUIRED' };

  // Qué clase de negocio es. Decide qué módulos se encienden, y por eso se
  // pregunta al principio y no en un ajuste escondido: un supermercado que
  // empieza con pantalla de cocina y mesas ya empieza mal.
  const businessType = formData.get('business_type') === 'grocery' ? 'grocery' : 'restaurant';

  const currencyCode = String(formData.get('currency') ?? 'EUR').toUpperCase();
  const currency = getCurrency(currencyCode);

  // Slug único: si "la-trattoria" está cogido probamos "la-trattoria-2", etc.
  const base = slugify(name) || 'restaurante';
  let slug = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const { data: taken } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!taken) break;
    slug = `${base}-${attempt}`;
  }

  const { error } = await supabase.from('restaurants').insert({
    owner_id: user.id,
    slug,
    name,
    description: String(formData.get('description') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: user.email ?? null,
    address: String(formData.get('address') ?? '').trim() || null,
    city: String(formData.get('city') ?? '').trim() || null,
    country: String(formData.get('country') ?? 'ES').toUpperCase().slice(0, 2),
    currency: currency.code,
    currency_decimals: currency.decimals,
    timezone: String(formData.get('timezone') ?? 'Europe/Madrid'),
    business_type: businessType,
    // Un supermercado no sirve en mesa. La base lo apaga igualmente, pero
    // mandar el valor correcto evita que el formulario mienta.
    dinein_enabled: businessType !== 'grocery' && formData.get('dinein') === 'on',
    delivery_enabled: formData.get('delivery') === 'on',
    pickup_enabled: formData.get('pickup') === 'on',
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/dashboard');
  return { ok: true, slug };
}
