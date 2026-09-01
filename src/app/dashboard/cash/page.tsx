import { requireSection } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  CashView,
  type CashReport,
  type CashHistoryRow,
  type AuditRow,
} from '@/components/dashboard/cash-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Caja' };

export default async function CashPage() {
  const { restaurant } = await requireSection('cash');
  const supabase = await createServerSupabase();

  const [{ data: actual }, { data: historial }, { data: rastro }] = await Promise.all([
    supabase.rpc('current_cash_session', { p_restaurant_id: restaurant.id }),
    supabase.rpc('cash_sessions_list', { p_restaurant_id: restaurant.id, p_limit: 30 }),
    supabase.rpc('money_audit_list', { p_restaurant_id: restaurant.id, p_limit: 40 }),
  ]);

  return (
    <CashView
      report={(actual as unknown as CashReport | null) ?? null}
      history={(historial as unknown as CashHistoryRow[] | null) ?? []}
      audit={(rastro as unknown as AuditRow[] | null) ?? []}
      currency={restaurant.currency}
      currencyDecimals={restaurant.currency_decimals}
    />
  );
}
