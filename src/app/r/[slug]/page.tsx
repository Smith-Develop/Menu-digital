import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Bike, Clock, MapPin, Phone, UtensilsCrossed } from 'lucide-react';
import { getI18n } from '@/i18n';
import {
  getRestaurantBySlug,
  getRestaurantCategories,
  getRestaurantProducts,
  getRestaurantBanners,
} from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { createPublicSupabase } from '@/lib/supabase/server';
import { Rating, EmptyState } from '@/components/ui/misc';
import { MenuBrowser } from '@/components/storefront/menu-browser';
import { TableBanner } from '@/components/storefront/table-banner';
import { BannerCarousel } from '@/components/storefront/banner-carousel';
import { formatMoney } from '@/lib/money';

export const revalidate = 30;

export default async function RestaurantMenuPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { t } = await getI18n();

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const [categories, products, tableCode, banners] = await Promise.all([
    getRestaurantCategories(restaurant.id),
    getRestaurantProducts(restaurant.id),
    getTableCodeFor(slug),
    // La portada ya se ve arriba: los banners que repiten esa imagen se omiten.
    getRestaurantBanners(restaurant.id, restaurant.cover_url),
  ]);

  let tableName: string | null = null;
  if (tableCode) {
    const supabase = createPublicSupabase();
    const { data } = await supabase
      .from('tables')
      .select('name')
      .eq('code', tableCode)
      .eq('restaurant_id', restaurant.id)
      .maybeSingle();
    tableName = data?.name ?? null;
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto pb-6 lg:px-8 lg:py-6">
      {/* Ficha del restaurante: en escritorio, portada y datos van en paralelo. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-8 lg:rounded-sheet lg:bg-white lg:p-6 lg:shadow-chip">
        <div className="relative h-[210px] w-full overflow-hidden bg-surface-muted lg:h-full lg:min-h-[240px] lg:rounded-2xl">
          {restaurant.cover_url ? (
            <Image
              src={restaurant.cover_url}
              alt={restaurant.name}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 420px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-200">
              <UtensilsCrossed className="h-10 w-10" />
            </div>
          )}
          {!restaurant.is_open && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/55">
              <span className="rounded-full bg-white px-5 py-2 text-sm font-bold uppercase tracking-wide text-ink">
                {t.storefront.closed}
              </span>
            </div>
          )}
        </div>

        <div className="px-5 pt-5 lg:px-0 lg:pt-0">
          {tableName && <TableBanner tableName={tableName} slug={slug} className="mb-4" />}

          <h1 className="font-display text-2xl font-bold text-ink lg:text-3xl">{restaurant.name}</h1>
          {restaurant.description && (
            <p className="mt-2 text-sm leading-relaxed text-ink-300">{restaurant.description}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Rating value={Number(restaurant.rating)} count={restaurant.rating_count} />
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
              <Bike className="h-4 w-4 text-brand" />
              {restaurant.delivery_fee_cents === 0
                ? t.common.free
                : formatMoney(
                    restaurant.delivery_fee_cents,
                    restaurant.currency,
                    restaurant.currency_decimals,
                  )}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
              <Clock className="h-4 w-4 text-brand" />
              {restaurant.avg_prep_minutes} {t.common.min}
            </span>
          </div>

          {(restaurant.address || restaurant.phone) && (
            <div className="mt-3 space-y-1 text-xs text-ink-300">
              {restaurant.address && (
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {restaurant.address}
                </p>
              )}
              {restaurant.phone && (
                <a href={`tel:${restaurant.phone}`} className="flex items-center gap-1.5 hover:text-brand">
                  <Phone className="h-3.5 w-3.5" />
                  {restaurant.phone}
                </a>
              )}
            </div>
          )}

          {restaurant.min_order_cents > 0 && (
            <p className="mt-3 text-xs text-ink-300">
              {t.storefront.minOrder}:{' '}
              <span className="font-semibold text-ink-600">
                {formatMoney(
                  restaurant.min_order_cents,
                  restaurant.currency,
                  restaurant.currency_decimals,
                )}
              </span>
            </p>
          )}
        </div>
      </div>

      {banners.length > 0 && (
        <div className="mt-6 lg:[&_ul]:px-0">
          <BannerCarousel
            banners={banners.map((banner) => ({
              id: banner.id,
              title: banner.title,
              subtitle: banner.subtitle,
              image_url: banner.image_url,
              link_url: banner.link_url,
            }))}
          />
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed className="h-7 w-7" />}
          title={t.common.empty}
          description={t.storefront.noRestaurants}
        />
      ) : (
        <div className="lg:mt-6 lg:rounded-sheet lg:bg-white lg:pb-6 lg:shadow-chip">
          <MenuBrowser
            slug={slug}
            categories={categories.map((c) => ({ id: c.id, name: c.name, image: c.image_url }))}
            products={products.map((p) => ({
              id: p.id,
              categoryId: p.catalog_category_id,
              name: p.name,
              description: p.description,
              priceCents: p.price_cents,
              image: p.image_url,
              rating: Number(p.rating),
              has3d: Boolean(p.model_3d_url),
              available: p.is_available,
            }))}
            currency={restaurant.currency}
            currencyDecimals={restaurant.currency_decimals}
          />
        </div>
      )}
    </div>
  );
}
