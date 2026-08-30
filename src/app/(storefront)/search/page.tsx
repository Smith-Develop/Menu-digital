import Image from 'next/image';
import Link from 'next/link';
import { SearchX, Store } from 'lucide-react';
import { getI18n } from '@/i18n';
import { resolveCity } from '@/lib/customer-location';
import { listRestaurants, listHomeCategories, listFeaturedProducts } from '@/lib/queries/public';
import { createPublicSupabase } from '@/lib/supabase/server';
import { SearchField } from '@/components/storefront/search-field';
import { SectionHeader, EmptyState, Rating } from '@/components/ui/misc';
import { PopularCard, RestaurantCard } from '@/components/storefront/cards';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Busca platos por texto o por categoría del catálogo, siempre dentro de la
 * ciudad del cliente.
 */
async function searchDishes(options: {
  term: string;
  categorySlug: string | null;
  citySlug: string | null;
}) {
  const supabase = createPublicSupabase();

  let restaurantQuery = supabase
    .from('restaurants')
    .select('id, name, slug, currency, currency_decimals')
    .eq('is_active', true);
  if (options.citySlug) restaurantQuery = restaurantQuery.eq('city_slug', options.citySlug);

  const { data: restaurants } = await restaurantQuery;
  if (!restaurants?.length) return [];

  let query = supabase
    .from('products')
    .select('*')
    .eq('is_available', true)
    .in('restaurant_id', restaurants.map((r) => r.id))
    .limit(30);

  if (options.categorySlug) {
    const { data: category } = await supabase
      .from('catalog_categories')
      .select('id')
      .eq('slug', options.categorySlug)
      .maybeSingle();
    if (!category) return [];
    query = query.eq('catalog_category_id', category.id);
  }

  if (options.term) {
    const like = `%${options.term}%`;
    query = query.or(`name.ilike.${like},description.ilike.${like}`);
  }

  const { data: products } = await query;
  if (!products?.length) return [];

  const byId = new Map(restaurants.map((r) => [r.id, r]));
  return products
    .map((product) => ({ ...product, restaurant: byId.get(product.restaurant_id) }))
    .filter((p) => p.restaurant);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string }>;
}) {
  const { t } = await getI18n();
  const { q, cat } = await searchParams;
  const term = q?.trim() ?? '';
  const categorySlug = cat?.trim() || null;

  const { citySlug } = await resolveCity();
  const searching = Boolean(term || categorySlug);

  const [restaurants, categories, dishes, popular] = await Promise.all([
    listRestaurants({ search: term || undefined, limit: searching ? 12 : 6, citySlug }),
    listHomeCategories(citySlug, 12),
    searching ? searchDishes({ term, categorySlug, citySlug }) : Promise.resolve([]),
    searching ? Promise.resolve([]) : listFeaturedProducts(6, citySlug),
  ]);

  const activeCategory = categories.find((c) => c.slug === categorySlug);
  const heading = activeCategory
    ? activeCategory.name
    : term
      ? `${t.storefront.resultsFor} “${term}”`
      : '';
  const noResults = searching && restaurants.length === 0 && dishes.length === 0;

  return (
    <div className="pb-8">
      <div className="px-5 pt-5 lg:px-0">
        <h1 className="mb-4 font-display text-xl font-bold text-ink-700">{t.common.search}</h1>
        <SearchField defaultValue={term} placeholder={t.common.searchPlaceholder} />
      </div>

      {categories.length > 0 && (
        <section className="mt-6 px-5 lg:px-0">
          <SectionHeader title={t.storefront.categories} />
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
            {categorySlug && (
              <Link
                href="/search"
                className="shrink-0 rounded-pill border border-surface-line bg-white px-5 py-2.5 text-[13px] font-semibold text-ink-500 transition-colors hover:border-brand hover:text-brand"
              >
                {t.common.all}
              </Link>
            )}
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/search?cat=${category.slug}`}
                className={cn(
                  'shrink-0 rounded-pill px-5 py-2.5 text-[13px] font-semibold transition-colors',
                  category.slug === categorySlug
                    ? 'bg-brand text-brand-contrast'
                    : 'border border-surface-line bg-white text-ink-600 hover:border-brand hover:text-brand',
                )}
              >
                {category.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {noResults && (
        <EmptyState
          icon={<SearchX className="h-7 w-7" />}
          title={`${t.storefront.noResults} “${heading || term}”`}
          description={t.common.empty}
        />
      )}

      {dishes.length > 0 && (
        <section className="mt-7 px-5 lg:px-0">
          <SectionHeader title={heading} />
          <ul className="stagger divide-y divide-surface-line lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0">
            {dishes.map((dish) => (
              <li key={dish.id} className="lg:border-b lg:border-surface-line">
                <Link
                  href={`/r/${dish.restaurant!.slug}/p/${dish.id}`}
                  className="flex items-center gap-3.5 py-3 transition-colors hover:bg-surface-soft"
                >
                  <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                    {dish.image_url && (
                      <Image src={dish.image_url} alt={dish.name} fill sizes="52px" className="object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink-700">{dish.name}</span>
                    <span className="block truncate text-xs text-ink-300">{dish.restaurant!.name}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-brand">
                    {formatMoney(dish.price_cents, dish.restaurant!.currency, dish.restaurant!.currency_decimals)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {restaurants.length > 0 && (
        <section className="mt-7 px-5 lg:px-0">
          <SectionHeader
            title={searching ? t.storefront.openRestaurants : t.storefront.suggestedRestaurants}
          />
          {searching ? (
            <ul className="stagger divide-y divide-surface-line lg:grid lg:grid-cols-2 lg:gap-x-8 lg:divide-y-0">
              {restaurants.map((restaurant) => (
                <li key={restaurant.id} className="lg:border-b lg:border-surface-line">
                  <Link
                    href={`/r/${restaurant.slug}`}
                    className="flex items-center gap-3.5 py-3 transition-colors hover:bg-surface-soft"
                  >
                    <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                      {restaurant.cover_url ? (
                        <Image src={restaurant.cover_url} alt={restaurant.name} fill sizes="52px" className="object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-ink-200">
                          <Store className="h-5 w-5" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink-700">
                        {restaurant.name}
                      </span>
                      <Rating value={Number(restaurant.rating)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">
              {restaurants.map((restaurant) => (
                <RestaurantCard
                  key={restaurant.id}
                  slug={restaurant.slug}
                  name={restaurant.name}
                  description={restaurant.description}
                  cover={restaurant.cover_url}
                  rating={Number(restaurant.rating)}
                  ratingCount={restaurant.rating_count}
                  deliveryFeeCents={restaurant.delivery_fee_cents}
                  prepMinutes={restaurant.avg_prep_minutes}
                  currency={restaurant.currency}
                  currencyDecimals={restaurant.currency_decimals}
                  isOpen={restaurant.is_open}
                  cuisineTags={restaurant.cuisine_tags}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {popular.length > 0 && (
        <section className="mt-9">
          <div className="px-5 lg:px-0">
            <SectionHeader title={t.storefront.popular} />
          </div>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-4 lg:px-0">
            {popular.map((product) => (
              <PopularCard
                key={product.id}
                href={product.restaurant ? `/r/${product.restaurant.slug}/p/${product.id}` : '/search'}
                name={product.name}
                subtitle={product.restaurant?.name}
                priceCents={product.price_cents}
                currency={product.restaurant?.currency ?? 'EUR'}
                currencyDecimals={product.restaurant?.currency_decimals ?? 2}
                image={product.image_url}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
