import Link from 'next/link';
import { Search, Store } from 'lucide-react';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { listRestaurants, listGlobalCategories, listFeaturedProducts } from '@/lib/queries/public';
import { TopBar } from '@/components/storefront/top-bar';
import { SectionHeader, EmptyState } from '@/components/ui/misc';
import { CategoryChip, PopularCard, RestaurantCard } from '@/components/storefront/cards';

export const revalidate = 60;

function greetingKey(): 'goodMorning' | 'goodAfternoon' | 'goodEvening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'goodMorning';
  if (hour < 20) return 'goodAfternoon';
  return 'goodEvening';
}

export default async function MarketplacePage() {
  const { t } = await getI18n();
  const [profile, restaurants, categories, featured] = await Promise.all([
    getSessionProfile(),
    listRestaurants({ limit: 20 }),
    listGlobalCategories(10),
    listFeaturedProducts(8),
  ]);

  const firstName = profile?.full_name?.split(' ')[0];
  const location = [restaurants[0]?.city, restaurants[0]?.country].filter(Boolean).join(', ');

  return (
    <>
      <TopBar location={location || undefined} />

      <div className="px-5">
        <p className="text-base text-ink">
          {firstName ? `${t.storefront.greeting} ${firstName}, ` : ''}
          <span className="font-bold">{t.storefront[greetingKey()]}</span>
        </p>

        <Link
          href="/search"
          className="mt-4 flex items-center gap-3 rounded-xl bg-surface-field px-4 py-4 text-ink-400"
        >
          <Search className="h-5 w-5" />
          <span className="text-[15px]">{t.common.searchPlaceholder}</span>
        </Link>
      </div>

      {categories.length > 0 && (
        <section className="mt-7">
          <div className="px-5">
            <SectionHeader title={t.storefront.categories} href="/search" actionLabel={t.common.seeAll} />
          </div>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-2">
            {categories.map((category) => (
              <CategoryChip
                key={category.slug}
                label={category.name}
                image={category.image_url}
                href={`/search?q=${encodeURIComponent(category.name)}`}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-7 px-5">
        <SectionHeader
          title={t.storefront.openRestaurants}
          href="/search"
          actionLabel={t.common.seeAll}
        />

        {restaurants.length === 0 ? (
          <EmptyState
            icon={<Store className="h-7 w-7" />}
            title={t.storefront.noRestaurants}
            description={t.common.empty}
          />
        ) : (
          <div className="space-y-7">
            {restaurants.slice(0, 8).map((restaurant) => (
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

      {featured.length > 0 && (
        <section className="mt-9 pb-8">
          <div className="px-5">
            <SectionHeader title={t.storefront.popular} />
          </div>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-4">
            {featured.map((product) => (
              <PopularCard
                key={product.id}
                href={
                  product.restaurant
                    ? `/r/${product.restaurant.slug}/p/${product.id}`
                    : '/search'
                }
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
    </>
  );
}
