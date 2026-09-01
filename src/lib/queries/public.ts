import { createPublicSupabase } from '@/lib/supabase/server';
import type { Tables } from '@/types/database';

export type Restaurant = Tables<'restaurants'>;
export type Category = Tables<'catalog_categories'>;
export type Product = Tables<'products'>;
export type OptionGroup = Tables<'option_groups'> & { options: Tables<'options'>[] };
export type ProductWithOptions = Product & { optionGroups: OptionGroup[] };

/**
 * Restaurantes visibles en el marketplace.
 *
 * `citySlug` acota el listado a la ciudad del cliente: no tiene sentido
 * enseñarle locales que no reparten donde está.
 */
export async function listRestaurants(options?: {
  search?: string;
  limit?: number;
  citySlug?: string | null;
}) {
  const supabase = createPublicSupabase();
  let query = supabase
    .from('restaurants')
    .select('*')
    .eq('is_active', true)
    .order('is_open', { ascending: false })
    .order('rating', { ascending: false })
    .limit(options?.limit ?? 40);

  if (options?.citySlug) query = query.eq('city_slug', options.citySlug);

  if (options?.search) {
    const term = `%${options.search}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term},city.ilike.${term}`);
  }

  const { data } = await query;
  return data ?? [];
}

export type HomeBanner = {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_slug: string;
};

/** Banners de la portada: aleatorios y solo de la ciudad del cliente. */
export async function listHomeBanners(citySlug: string | null, limit = 6): Promise<HomeBanner[]> {
  const supabase = createPublicSupabase();
  const { data } = await supabase.rpc('home_banners', {
    p_city_slug: citySlug,
    p_limit: limit,
  });
  return (data as HomeBanner[] | null) ?? [];
}

/**
 * Banners propios de un restaurante, para su tienda.
 *
 * Se descartan los que usan la misma imagen que la portada: el cliente ya la
 * ha visto arriba y repetirla parece un fallo de maquetación.
 */
export async function getRestaurantBanners(restaurantId: string, coverUrl?: string | null) {
  const supabase = createPublicSupabase();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('banners')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order('position');

  return (data ?? []).filter((banner) => !coverUrl || banner.image_url !== coverUrl);
}

export async function getRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const supabase = createPublicSupabase();
  const { data } = await supabase
    .from('restaurants')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  return data ?? null;
}

export async function getRestaurantProducts(
  restaurantId: string,
  options?: { categoryId?: string; search?: string; featuredOnly?: boolean },
): Promise<Product[]> {
  const supabase = createPublicSupabase();
  let query = supabase
    .from('products')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('position');

  if (options?.categoryId) query = query.eq('catalog_category_id', options.categoryId);
  if (options?.featuredOnly) query = query.eq('is_featured', true);
  if (options?.search) {
    const term = `%${options.search}%`;
    query = query.or(`name.ilike.${term},description.ilike.${term}`);
  }

  const { data } = await query;
  return data ?? [];
}

/** Ficha completa de un plato, con sus grupos de opciones ordenados. */
export async function getProduct(
  restaurantId: string,
  productId: string,
): Promise<ProductWithOptions | null> {
  const supabase = createPublicSupabase();

  const { data: product } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (!product) return null;

  const { data: groups } = await supabase
    .from('option_groups')
    .select('*')
    .eq('product_id', product.id)
    .order('position');

  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: options } = groupIds.length
    ? await supabase.from('options').select('*').in('group_id', groupIds).order('position')
    : { data: [] as Tables<'options'>[] };

  return {
    ...product,
    optionGroups: (groups ?? []).map((group) => ({
      ...group,
      options: (options ?? []).filter((o) => o.group_id === group.id),
    })),
  };
}

/** Platos destacados de la ciudad del cliente, para la portada. */
export async function listFeaturedProducts(limit = 8, citySlug?: string | null) {
  const supabase = createPublicSupabase();

  // Primero los restaurantes de la ciudad; sin ellos no hay nada que destacar.
  let restaurantQuery = supabase
    .from('restaurants')
    .select('id, name, slug, currency, currency_decimals')
    .eq('is_active', true);
  if (citySlug) restaurantQuery = restaurantQuery.eq('city_slug', citySlug);

  const { data: restaurants } = await restaurantQuery;
  if (!restaurants?.length) return [];

  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('is_featured', true)
    .eq('is_available', true)
    .in('restaurant_id', restaurants.map((r) => r.id))
    .order('rating', { ascending: false })
    .limit(limit);

  if (!data?.length) return [];

  const byId = new Map(restaurants.map((r) => [r.id, r]));
  return data.map((product) => ({ ...product, restaurant: byId.get(product.restaurant_id) ?? null }));
}

/** Mesa a partir del código del QR, con su restaurante. */
export async function getTableByCode(code: string) {
  const supabase = createPublicSupabase();
  const { data: table } = await supabase
    .from('tables')
    .select('*')
    .eq('code', code)
    .eq('is_active', true)
    .maybeSingle();

  if (!table) return null;

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', table.restaurant_id)
    .eq('is_active', true)
    .maybeSingle();

  if (!restaurant) return null;
  return { table, restaurant };
}

/** Categorías del catálogo con platos servibles en la ciudad del cliente. */
export async function listHomeCategories(citySlug?: string | null, limit = 12) {
  const supabase = createPublicSupabase();
  const { data } = await supabase.rpc('home_categories', {
    p_city_slug: citySlug ?? null,
    p_limit: limit,
  });
  return (data as { id: string; name: string; slug: string; image_url: string | null; products: number }[] | null) ?? [];
}

/** Categorías del catálogo presentes en la carta de un restaurante. */
export async function getRestaurantCategories(restaurantId: string) {
  const supabase = createPublicSupabase();

  const { data: products } = await supabase
    .from('products')
    .select('catalog_category_id')
    .eq('restaurant_id', restaurantId)
    .not('catalog_category_id', 'is', null);

  const ids = [...new Set((products ?? []).map((p) => p.catalog_category_id))].filter(
    Boolean,
  ) as string[];
  if (ids.length === 0) return [];

  const { data } = await supabase
    .from('catalog_categories')
    .select('*')
    .in('id', ids)
    .eq('is_active', true)
    .order('position');

  return data ?? [];
}

/**
 * ¿Puede este local repartir a domicilio?
 *
 * No basta con su propio interruptor: el plan contratado también decide. Se
 * pregunta a la base y no se deduce aquí porque la misma regla la aplica
 * `place_order`, y dos copias de una condición acaban discrepando.
 */
export async function deliveryAllowed(restaurantId: string): Promise<boolean> {
  const supabase = createPublicSupabase();
  const { data } = await supabase.rpc('delivery_allowed', { p_restaurant_id: restaurantId });
  return data !== false;
}
