import Image from 'next/image';
import Link from 'next/link';
import { SearchX, Store } from 'lucide-react';
import { getI18n } from '@/i18n';
import { listRestaurants, listGlobalCategories, listFeaturedProducts } from '@/lib/queries/public';
import { createPublicSupabase } from '@/lib/supabase/server';
import { SearchField } from '@/components/storefront/search-field';
import { SectionHeader, EmptyState, Rating } from '@/components/ui/misc';
import { PopularCard, RestaurantCard } from '@/components/storefront/cards';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Busca platos en todo el marketplace y los devuelve con su restaurante. */
async function searchDishes(term: string) {
  const supabase = createPublicSupabase();
  const like = `%${term}%`;

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('is_available', true)
    .or(`name.ilike.${like},description.ilike.${like}`)
    .limit(20);

  if (!products?.length) return [];

  const { data: restaurants } = await supabase
    .from('restaurants')
    .select('id, name, slug, currency, currency_decimals, is_active')
    .in('id', [...new Set(products.map((p) => p.restaurant_id))]);

  const byId = new Map((restaurants ?? []).filter((r) => r.is_active).map((r) => [r.id, r]));

  return products
    .map((product) => ({ ...product, restaurant: byId.get(product.restaurant_id) }))
    .filter((p) => p.restaurant);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { t } = await getI18n();
  const { q } = await searchParams;
  const term = q?.trim() ?? '';

  const [restaurants, categories, dishes, popular] = await Promise.all([
    listRestaurants({ search: term || undefined, limit: term ? 12 : 6 }),
    listGlobalCategories(8),
    term ? searchDishes(term) : Promise.resolve([]),
    term ? Promise.resolve([]) : listFeaturedProducts(6),
  ]);

  const noResults = Boolean(term) && restaurants.length === 0 && dishes.length === 0;

  return (
    <div className="pb-8">
      <div className="px-5 pt-5">
        <h1 className="mb-4 font-display text-xl font-bold text-ink-700">{t.common.search}</h1>
        <SearchField defaultValue={term} placeholder={t.common.searchPlaceholder} />
      </div>

      {!term && categories.length > 0 && (
        <section className="mt-7 px-5">
          <SectionHeader title={t.storefront.recentSearches} />
          <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/search?q=${encodeURIComponent(category.name)}`}
                className="shrink-0 rounded-pill border border-surface-line px-5 py-2.5 text-[13px] font-semibold text-ink-600 transition-colors hover:border-brand hover:text-brand"
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
          title={`${t.storefront.noResults} “${term}”`}
          description={t.common.empty}
        />
      )}

      {dishes.length > 0 && (
        <section className="mt-7 px-5">
          <SectionHeader title={`${t.storefront.resultsFor} “${term}”`} />
          <ul className="divide-y divide-surface-line">
            {dishes.map((dish) => (
              <li key={dish.id}>
                <Link
                  href={`/r/${dish.restaurant!.slug}/p/${dish.id}`}
                  className="flex items-center gap-3.5 py-3"
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
                    {formatMoney(
                      dish.price_cents,
                      dish.restaurant!.currency,
                      dish.restaurant!.currency_decimals,
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {restaurants.length > 0 && (
        <section className="mt-7 px-5">
          <SectionHeader
            title={term ? t.storefront.openRestaurants : t.storefront.suggestedRestaurants}
          />
          {term ? (
            <ul className="divide-y divide-surface-line">
              {restaurants.map((restaurant) => (
                <li key={restaurant.id}>
                  <Link href={`/r/${restaurant.slug}`} className="flex items-center gap-3.5 py-3">
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
            <div className="space-y-7">
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
          <div className="px-5">
            <SectionHeader title={t.storefront.popular} />
          </div>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-4">
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
