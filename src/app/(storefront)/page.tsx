import Link from 'next/link';
import { MapPin, Search, Store } from 'lucide-react';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { resolveCity } from '@/lib/customer-location';
import {
  listRestaurants,
  listGlobalCategories,
  listFeaturedProducts,
  listHomeBanners,
} from '@/lib/queries/public';
import { createPublicSupabase } from '@/lib/supabase/server';
import { TopBar } from '@/components/storefront/top-bar';
import { SectionHeader, EmptyState } from '@/components/ui/misc';
import { CategoryChip, PopularCard, RestaurantCard } from '@/components/storefront/cards';
import { BannerCarousel } from '@/components/storefront/banner-carousel';
import {
  NotificationPopup,
  type PopupNotification,
} from '@/components/storefront/notification-popup';
import { LocationPicker } from '@/components/storefront/location-picker';
import { interpolate } from '@/i18n/provider';

export const dynamic = 'force-dynamic';

function greetingKey(): 'goodMorning' | 'goodAfternoon' | 'goodEvening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'goodMorning';
  if (hour < 20) return 'goodAfternoon';
  return 'goodEvening';
}

export default async function MarketplacePage() {
  const { t } = await getI18n();
  const { location, citySlug, cities } = await resolveCity();

  const [profile, restaurants, categories, featured, banners, notifications] =
    await Promise.all([
      getSessionProfile(),
      listRestaurants({ limit: 24, citySlug }),
      listGlobalCategories(10, citySlug),
      listFeaturedProducts(10, citySlug),
      listHomeBanners(citySlug, 6),
      createPublicSupabase()
        .rpc('active_notifications', { p_city_slug: citySlug })
        .then(({ data }) => (data as PopupNotification[] | null) ?? []),
    ]);

  const firstName = profile?.full_name?.split(' ')[0];
  const cityName = location?.city ?? cities.find((c) => c.city_slug === citySlug)?.city;

  return (
    <>
      <NotificationPopup notifications={notifications} />

      <TopBar cities={cities} location={location} />

      <div className="px-5 lg:px-0">
        <p className="text-base text-ink lg:text-lg">
          {firstName ? `${t.storefront.greeting} ${firstName}, ` : ''}
          <span className="font-bold">{t.storefront[greetingKey()]}</span>
        </p>

        <Link
          href="/search"
          className="mt-4 flex items-center gap-3 rounded-xl bg-surface-field px-4 py-4 text-ink-400 transition-colors hover:bg-surface-muted lg:max-w-xl"
        >
          <Search className="h-5 w-5" />
          <span className="text-[15px]">{t.common.searchPlaceholder}</span>
        </Link>
      </div>

      {banners.length > 0 && (
        <div className="mt-6 lg:-mx-0">
          <BannerCarousel banners={banners} className="lg:[&_ul]:px-0" />
        </div>
      )}

      {categories.length > 0 && (
        <section className="mt-8">
          <div className="px-5 lg:px-0">
            <SectionHeader title={t.storefront.categories} href="/search" actionLabel={t.common.seeAll} />
          </div>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-2 lg:flex-wrap lg:overflow-visible lg:px-0">
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

      <section className="mt-8 px-5 lg:px-0">
        <SectionHeader
          title={
            cityName
              ? `${t.storefront.openRestaurants} · ${cityName}`
              : t.storefront.openRestaurants
          }
          href="/search"
          actionLabel={t.common.seeAll}
        />

        {restaurants.length === 0 ? (
          <EmptyState
            icon={<Store className="h-7 w-7" />}
            title={
              cityName
                ? interpolate(t.location.noRestaurantsInCity, { city: cityName })
                : t.storefront.noRestaurants
            }
            description={t.location.noRestaurantsInCityHint}
            action={
              <div className="inline-flex">
                <LocationPicker cities={cities} current={location} variant="inline" />
              </div>
            }
            className="rounded-2xl bg-white shadow-chip"
          />
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

      {featured.length > 0 && (
        <section className="mt-10 pb-8">
          <div className="px-5 lg:px-0">
            <SectionHeader title={t.storefront.popular} />
          </div>
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-4 lg:px-0">
            {featured.map((product) => (
              <PopularCard
                key={product.id}
                href={
                  product.restaurant ? `/r/${product.restaurant.slug}/p/${product.id}` : '/search'
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

      {cityName && (
        <p className="px-5 pb-6 text-center text-xs text-ink-300 lg:px-0">
          <MapPin className="mr-1 inline h-3 w-3" />
          {t.storefront.deliverTo}: <span className="font-semibold text-ink-500">{cityName}</span>
        </p>
      )}
    </>
  );
}
