'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';

export type FavoriteResult = { ok: true; favorite: boolean } | { ok: false; error: string };

/**
 * Marca o desmarca un plato como favorito.
 *
 * Requiere sesión: los favoritos son de una persona, no de un navegador. Quien
 * no ha entrado recibe `SIGN_IN_REQUIRED` y la interfaz le propone identificarse
 * en vez de perder el gesto en el vacío.
 */
export async function toggleFavorite(productId: string): Promise<FavoriteResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'SIGN_IN_REQUIRED' };

  const { data: existing } = await supabase
    .from('favorites')
    .select('product_id')
    .eq('user_id', user.id)
    .eq('product_id', productId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('product_id', productId);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/favorites');
    return { ok: true, favorite: false };
  }

  const { error } = await supabase
    .from('favorites')
    .insert({ user_id: user.id, product_id: productId });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/favorites');
  return { ok: true, favorite: true };
}

/** Platos que esa persona ha marcado, con su restaurante. */
export async function listFavorites() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('favorites')
    .select('product_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const ids = (data ?? []).map((f) => f.product_id);
  if (ids.length === 0) return [];

  // Dos consultas en lugar de un join anidado: así la lista no depende de que
  // PostgREST tenga cargada la relación entre favoritos y productos.
  const { data: products } = await supabase
    .from('products')
    .select('id, name, description, price_cents, image_url, restaurant_id, is_available')
    .in('id', ids);

  const restaurantIds = [...new Set((products ?? []).map((p) => p.restaurant_id))];
  const { data: restaurants } = restaurantIds.length
    ? await supabase
        .from('restaurants')
        .select('id, name, slug, currency, currency_decimals')
        .in('id', restaurantIds)
    : { data: [] };

  const byId = new Map((restaurants ?? []).map((r) => [r.id, r]));

  // Se respeta el orden en que se marcaron, que es el que devuelve `favorites`.
  return ids
    .map((id) => (products ?? []).find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: product.price_cents,
      image: product.image_url,
      available: product.is_available,
      restaurant: byId.get(product.restaurant_id) ?? null,
    }));
}
