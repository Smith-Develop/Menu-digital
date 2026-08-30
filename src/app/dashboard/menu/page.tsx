import { getI18n } from '@/i18n';
import { requireStaffContext } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { MenuManager } from '@/components/dashboard/menu-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Carta' };

export default async function MenuPage() {
  const { restaurant, subscription } = await requireStaffContext();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from('categories').select('*').eq('restaurant_id', restaurant.id).order('position'),
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
          {(products ?? []).length} {t.dashboard.products.toLowerCase()} ·{' '}
          {(categories ?? []).length} {t.dashboard.categories.toLowerCase()}
        </p>
      </div>

      <MenuManager
        restaurantId={restaurant.id}
        currency={restaurant.currency}
        currencyDecimals={restaurant.currency_decimals}
        allows3d={subscription?.plan?.allows_3d ?? true}
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          imageUrl: c.image_url,
          position: c.position,
          isActive: c.is_active,
        }))}
        products={(products ?? []).map((p) => ({
          id: p.id,
          categoryId: p.category_id,
          name: p.name,
          description: p.description,
          priceCents: p.price_cents,
          imageUrl: p.image_url,
          model3dUrl: p.model_3d_url,
          modelArUrl: p.model_ar_url,
          modelScale: Number(p.model_scale),
          prepMinutes: p.prep_minutes,
          calories: p.calories,
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
