import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { CatalogCategoriesManager } from '@/components/admin/catalog-categories-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Categorías' };

export default async function AdminCategoriesPage() {
  await requireSuperadmin();
  const { t } = await getI18n();
  const supabase = await createServerSupabase();

  const { data: categories } = await supabase
    .from('catalog_categories')
    .select('*')
    .order('position');

  // Cuántos platos usa cada categoría, para saber qué se rompe al borrarla.
  const { data: products } = await supabase
    .from('products')
    .select('catalog_category_id')
    .not('catalog_category_id', 'is', null);

  const usage = new Map<string, number>();
  for (const row of products ?? []) {
    if (row.catalog_category_id) {
      usage.set(row.catalog_category_id, (usage.get(row.catalog_category_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.catalog.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">{t.catalog.hint}</p>
      </div>

      <CatalogCategoriesManager
        categories={(categories ?? []).map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          imageUrl: category.image_url,
          position: category.position,
          isActive: category.is_active,
          products: usage.get(category.id) ?? 0,
        }))}
      />
    </div>
  );
}
