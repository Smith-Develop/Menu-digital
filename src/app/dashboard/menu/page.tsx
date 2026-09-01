import { getI18n } from '@/i18n';
import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { MenuManager } from '@/components/dashboard/menu-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Carta' };

export default async function MenuPage() {
  const { restaurant, subscription } = await requireSection('menu');
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: categories }, { data: products }] = await Promise.all([
    // Catálogo de la plataforma: el restaurante elige de aquí, no crea categorías.
    // El catálogo se filtra por vertical: los pasillos de un supermercado no
    // son las categorías de una carta, y una lista con las dos cosas no es
    // de nadie. Las que no declaran vertical valen para todos.
    supabase
      .from('catalog_categories')
      .select('*')
      .eq('is_active', true)
      .or(`business_type.is.null,business_type.eq.${restaurant.business_type}`)
      .order('position'),
    supabase.from('products').select('*').eq('restaurant_id', restaurant.id).order('position'),
  ]);

  const productIds = (products ?? []).map((p) => p.id);
  const { data: groups } = productIds.length
    ? await supabase.from('option_groups').select('*').in('product_id', productIds).order('position')
    : { data: [] };

  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: options } = groupIds.length
    ? await supabase.from('options').select('*').in('group_id', groupIds).order('position')
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.dashboard.menu}</h1>
        <p className="mt-1 text-sm text-ink-300">
          {(products ?? []).length} {t.dashboard.products.toLowerCase()}
        </p>
      </div>

      <MenuManager
        restaurantId={restaurant.id}
        businessType={restaurant.business_type}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        allows3d={subscription?.plan?.allows_3d ?? true}
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          imageUrl: c.image_url,
        }))}
        products={(products ?? []).map((p) => ({
          id: p.id,
          categoryId: p.catalog_category_id,
          name: p.name,
          description: p.description,
          priceCents: p.price_cents,
          imageUrl: p.image_url,
          model3dUrl: p.model_3d_url,
          modelArUrl: p.model_ar_url,
          modelScale: Number(p.model_scale),
          prepMinutes: p.prep_minutes,
          calories: p.calories,
          taxRate: p.tax_rate === null ? null : Number(p.tax_rate),
          trackStock: p.track_stock,
          stockQty: p.stock_qty,
          lowStockThreshold: p.low_stock_threshold,
          unit: p.unit,
          brand: p.brand,
          packSize: p.pack_size,
          barcode: p.barcode,
          netContent: p.net_content === null ? null : Number(p.net_content),
          soldByWeight: p.sold_by_weight,
          ingredients: p.ingredients,
          allergens: p.allergens,
          tags: p.tags,
          isAvailable: p.is_available,
          isFeatured: p.is_featured,
          position: p.position,
          optionGroups: (groups ?? [])
            .filter((g) => g.product_id === p.id)
            .map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.min_select,
              maxSelect: g.max_select,
              isRequired: g.is_required,
              options: (options ?? [])
                .filter((o) => o.group_id === g.id)
                .map((o) => ({
                  id: o.id,
                  name: o.name,
                  priceDeltaCents: o.price_delta_cents,
                  isDefault: o.is_default,
                  isAvailable: o.is_available,
                })),
            })),
        }))}
      />
    </div>
  );
}
