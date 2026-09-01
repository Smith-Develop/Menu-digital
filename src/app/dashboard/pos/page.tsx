import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  PosView,
  type PosProduct,
  type PosCategory,
  type PosTable,
} from '@/components/dashboard/pos-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Caja' };

export default async function PosPage() {
  const { restaurant } = await requireSection('pos');
  const supabase = await createServerSupabase();

  const [{ data: products }, { data: categories }, { data: tables }] = await Promise.all([
    supabase.from('products').select('*').eq('restaurant_id', restaurant.id).order('position'),
    supabase.from('catalog_categories').select('id, name').eq('is_active', true).order('position'),
    supabase
      .from('tables')
      .select('id, code, name')
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true)
      .order('name'),
  ]);

  // Las opciones se traen en dos consultas y se cosen aquí: los tipos generados
  // no llevan relaciones, así que supabase-js no puede inferir el anidado.
  const productIds = (products ?? []).map((p) => p.id);
  const { data: groups } = productIds.length
    ? await supabase.from('option_groups').select('*').in('product_id', productIds).order('position')
    : { data: [] };

  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: options } = groupIds.length
    ? await supabase.from('options').select('*').in('group_id', groupIds).order('position')
    : { data: [] };

  const catalogo: PosProduct[] = (products ?? []).map((p) => ({
    id: p.id,
    categoryId: p.catalog_category_id,
    name: p.name,
    priceCents: p.price_cents,
    imageUrl: p.image_url,
    isAvailable: p.is_available,
    trackStock: p.track_stock,
    stockQty: p.stock_qty,
    groups: (groups ?? [])
      .filter((g) => g.product_id === p.id)
      .map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        isRequired: g.is_required,
        options: (options ?? [])
          .filter((o) => o.group_id === g.id && o.is_available)
          .map((o) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents })),
      })),
  }));

  // Sólo las categorías que este restaurante usa: el catálogo de la plataforma
  // es largo y en una caja estorba lo que no se puede pedir.
  const usadas = new Set(catalogo.map((p) => p.categoryId).filter(Boolean));

  return (
    <PosView
      categories={((categories ?? []) as PosCategory[]).filter((c) => usadas.has(c.id))}
      products={catalogo}
      tables={(tables ?? []) as PosTable[]}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      taxRate={Number(restaurant.tax_rate)}
      deliveryFeeCents={restaurant.delivery_fee_cents}
      accepts={{
        cash: restaurant.accepts_cash,
        card: restaurant.accepts_card,
        tpv: restaurant.accepts_tpv,
      }}
    />
  );
}
