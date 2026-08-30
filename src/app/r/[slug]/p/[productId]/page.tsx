import { notFound } from 'next/navigation';
import { getRestaurantBySlug, getProduct } from '@/lib/queries/public';
import { ProductDetail } from '@/components/product/product-detail';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; productId: string }>;
}): Promise<Metadata> {
  const { slug, productId } = await params;
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return { title: 'Plato' };
  const product = await getProduct(restaurant.id, productId);
  if (!product) return { title: 'Plato' };

  return {
    title: `${product.name} · ${restaurant.name}`,
    description: product.description ?? undefined,
    openGraph: { images: product.image_url ? [product.image_url] : undefined },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string; productId: string }>;
}) {
  const { slug, productId } = await params;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const product = await getProduct(restaurant.id, productId);
  if (!product) notFound();

  return (
    <ProductDetail
      slug={slug}
      restaurantName={restaurant.name}
      restaurantLogo={restaurant.logo_url}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      product={{
        id: product.id,
        name: product.name,
        description: product.description,
        priceCents: product.price_cents,
        image: product.image_url,
        gallery: Array.isArray(product.gallery) ? (product.gallery as string[]) : [],
        model3dUrl: product.model_3d_url,
        modelArUrl: product.model_ar_url,
        modelScale: Number(product.model_scale),
        prepMinutes: product.prep_minutes,
        calories: product.calories,
        ingredients: product.ingredients,
        allergens: product.allergens,
        rating: Number(product.rating),
        ratingCount: product.rating_count,
        available: product.is_available,
        optionGroups: product.optionGroups.map((group) => ({
          id: group.id,
          name: group.name,
          minSelect: group.min_select,
          maxSelect: group.max_select,
          required: group.is_required,
          options: group.options
            .filter((o) => o.is_available)
            .map((o) => ({
              id: o.id,
              name: o.name,
              priceDeltaCents: o.price_delta_cents,
              isDefault: o.is_default,
            })),
        })),
      }}
    />
  );
}
