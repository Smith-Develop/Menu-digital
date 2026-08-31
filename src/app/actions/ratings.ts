'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';

export type RatingTarget = {
  type: 'restaurant' | 'product' | 'courier' | 'waiter';
  id: string;
  name: string;
  image: string | null;
  score: number | null;
};

export type RatingResult = { ok: true } | { ok: false; error: string };

/** Qué se puede valorar de un pedido entregado, con lo ya puntuado. */
export async function listRatingTargets(orderId: string): Promise<RatingTarget[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc('order_rating_targets', { p_order_id: orderId });
  return (data as unknown as RatingTarget[] | null) ?? [];
}

/**
 * Guarda una puntuación.
 *
 * Se puede corregir mientras siga siendo la misma persona y el mismo pedido: la
 * clave única lo garantiza y el `upsert` convierte el segundo intento en una
 * corrección en vez de un error.
 */
export async function rate(
  orderId: string,
  target: { type: RatingTarget['type']; id: string },
  score: number,
  comment?: string | null,
): Promise<RatingResult> {
  if (score < 1 || score > 5) return { ok: false, error: 'INVALID_SCORE' };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'SIGN_IN_REQUIRED' };

  const { error } = await supabase.from('ratings').upsert(
    {
      order_id: orderId,
      customer_id: user.id,
      target_type: target.type,
      target_id: target.id,
      score,
      comment: comment?.trim() || null,
    },
    { onConflict: 'order_id,target_type,target_id' },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath('/orders');
  return { ok: true };
}
