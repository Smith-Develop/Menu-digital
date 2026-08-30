import { createPublicSupabase } from '@/lib/supabase/server';
import type { Tables } from '@/types/database';

export type Restaurant = Tables<'restaurants'>;
export type Category = Tables<'categories'>;
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

/** Banners propios de un restaurante, para su tienda. */
export async function getRestaurantBanners(restaurantId: string) {
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
  return data ?? [];
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

export async function getRestaurantCategories(restaurantId: string): Promise<Category[]> {
  const supabase = createPublicSupabase();
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('position');
  return data ?? [];
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

  if (options?.categoryId) query = query.eq('category_id', options.categoryId);
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

/** Categorías agregadas de la ciudad del cliente (los "chips" de la portada). */
export async function listGlobalCategories(limit = 12, citySlug?: string | null) {
  const supabase = createPublicSupabase();

  let restaurantIds: string[] | null = null;
  if (citySlug) {
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('id')
      .eq('is_active', true)
      .eq('city_slug', citySlug);
    restaurantIds = (restaurants ?? []).map((r) => r.id);
    if (restaurantIds.length === 0) return [];
  }

  let categoryQuery = supabase
    .from('categories')
    .select('name, image_url')
    .eq('is_active', true)
    .limit(200);
  if (restaurantIds) categoryQuery = categoryQuery.in('restaurant_id', restaurantIds);

  const { data } = await categoryQuery;

  const seen = new Map<string, string | null>();
  for (const row of data ?? []) {
    const key = row.name.trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, row.image_url);
  }

  return [...seen.entries()].slice(0, limit).map(([name, image]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    slug: name,
    image_url: image,
  }));
}
