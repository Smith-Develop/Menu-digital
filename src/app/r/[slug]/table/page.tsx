import { notFound, redirect } from 'next/navigation';
import { getRestaurantBySlug, getTableByCode } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { createPublicSupabase } from '@/lib/supabase/server';
import { TablePanel, type TableBill } from '@/components/storefront/table-panel';

export const dynamic = 'force-dynamic';

export default async function TablePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const code = await getTableCodeFor(slug);
  if (!code) redirect(`/r/${slug}`);

  const found = await getTableByCode(code);
  if (!found || found.restaurant.id !== restaurant.id) redirect(`/r/${slug}`);

  // La cuenta incluye todo lo pedido en la mesa que aún no se ha cobrado.
  const supabase = createPublicSupabase();
  const { data: bill } = await supabase.rpc('table_bill', { p_table_code: code });

  return (
    <TablePanel
      slug={slug}
      tableCode={code}
      tableName={found.table.name}
      restaurantName={restaurant.name}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      bill={bill as unknown as TableBill | null}
    />
  );
}
