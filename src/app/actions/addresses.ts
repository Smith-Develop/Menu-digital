'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';

export type AddressResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Una dirección de entrega.
 *
 * La calle pide cinco caracteres por el mismo motivo que lo pide la base: una
 * ciudad no es una dirección, y «Madrid» cabía de sobra en un campo libre. Lo
 * demás es opcional porque cambia mucho de un país a otro —el barrio es media
 * dirección en Colombia y sobra en España— y exigirlo en todas partes obliga a
 * inventárselo en alguna.
 */
const esquema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().max(40).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  city: z.string().min(2).max(80),
  neighborhood: z.string().max(80).nullable().optional(),
  street: z.string().min(5).max(160),
  details: z.string().max(80).nullable().optional(),
  notes: z.string().max(200).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  isDefault: z.boolean().optional(),
});

const limpio = (valor: string | null | undefined) => valor?.trim() || null;

/** Crea o actualiza una dirección del cliente que está dentro. */
export async function saveAddress(input: unknown): Promise<AddressResult> {
  const parsed = esquema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'SIGN_IN_REQUIRED' };

  const d = parsed.data;
  const fila = {
    user_id: user.id,
    label: limpio(d.label),
    country: limpio(d.country),
    city: d.city.trim(),
    neighborhood: limpio(d.neighborhood),
    street: d.street.trim(),
    details: limpio(d.details),
    notes: limpio(d.notes),
    lat: d.lat ?? null,
    lng: d.lng ?? null,
  };

  // El identificador viaja en el cuerpo y no se usa para decidir de quién es la
  // fila: eso lo decide la política, que compara contra la sesión. Si alguien
  // manda el identificador de otro, el `update` no encuentra nada.
  const consulta = d.id
    ? supabase.from('customer_addresses').update(fila).eq('id', d.id).select('id').maybeSingle()
    : supabase.from('customer_addresses').insert(fila).select('id').maybeSingle();

  const { data, error } = await consulta;

  if (error) {
    // Las dos restricciones de la migración 0070 hablan del mismo error, y al
    // cliente hay que decírselo con palabras suyas, no con el nombre de una
    // restricción de Postgres.
    if (/calle_no_es_la_ciudad|calle_con_contenido/.test(error.message)) {
      return { ok: false, error: 'ADDRESS_INCOMPLETE' };
    }
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'ADDRESS_NOT_FOUND' };

  if (d.isDefault) {
    await supabase.rpc('set_default_address', { p_id: data.id });
  }

  revalidatePath('/account');
  return { ok: true, id: data.id };
}

/** La dirección de siempre. El cambio lo hace la base en una sola operación. */
export async function makeDefaultAddress(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('set_default_address', { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account');
  return { ok: true };
}

/**
 * Borra una dirección.
 *
 * Los pedidos que la usaron no la pierden: guardan una copia de cómo estaba al
 * pedir, así que un pedido de hace tres meses sigue diciendo a dónde se llevó.
 */
export async function deleteAddress(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('customer_addresses').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account');
  return { ok: true };
}
