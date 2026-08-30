import { notFound, redirect } from 'next/navigation';
import { getRestaurantBySlug, getTableByCode } from '@/lib/queries/public';
import { getTableCodeFor } from '@/lib/table-session';
import { createPublicSupabase } from '@/lib/supabase/server';
import { TablePanel } from '@/components/storefront/table-panel';

export const dynamic = 'force-dynamic';

export default async function TablePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) notFound();

  const code = await getTableCodeFor(slug);
  if (!code) redirect(`/r/${slug}`);

  const found = await getTableByCode(code);
  if (!found || found.restaurant.id !== restaurant.id) redirect(`/r/${slug}`);

  // Pedidos abiertos de esta mesa: el cliente ve su estado sin salir de la carta.
  const supabase = createPublicSupabase();
  const { data: orders } = await supabase
    .from('orders')
    .select('public_token, code, status, total_cents, created_at')
    .eq('table_id', found.table.id)
    .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
    .order('created_at', { ascending: false })
    .limit(5);

  return (
    <TablePanel
      slug={slug}
      tableCode={code}
      tableName={found.table.name}
      restaurantName={restaurant.name}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
      openOrders={(orders ?? []).map((o) => ({
        token: o.public_token,
        code: o.code,
        status: o.status,
        totalCents: o.total_cents,
        createdAt: o.created_at,
      }))}
    />
  );
}
