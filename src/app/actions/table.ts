'use server';

import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { sendUserPush } from '@/lib/push';
import { getI18n } from '@/i18n';

export type CallResult = { ok: true } | { ok: false; error: string };

/**
 * Aviso desde una mesa.
 *
 * Pasa por el servidor —y no por la llamada directa a la base de datos— porque
 * además de registrar el aviso hay que tocarle el móvil al camarero que atiende
 * esa mesa. Sonar en la comanda principal no basta cuando quien puede acudir
 * está en la otra punta del local.
 */
export async function callWaiter(
  tableCode: string,
  type: 'waiter' | 'bill' | 'water' | 'help',
  note?: string | null,
): Promise<CallResult> {
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc('call_waiter', {
    p_table_code: tableCode,
    p_type: type,
    p_note: note ?? null,
  });

  if (error) return { ok: false, error: error.message };

  // El aviso al móvil va aparte y con el error tragado: el aviso ya está
  // registrado y sonando en la comanda, y que un push falle no puede
  // convertirse en un error para quien está sentado en la mesa.
  void notifyAssignedWaiter(tableCode, type).catch(() => undefined);

  return { ok: true };
}

async function notifyAssignedWaiter(tableCode: string, type: string) {
  const service = createAdminSupabase();

  const { data: mesa } = await service
    .from('tables')
    .select('name, assigned_waiter_id, restaurant_id')
    .eq('code', tableCode)
    .maybeSingle();

  if (!mesa?.assigned_waiter_id) return;

  const { data: restaurante } = await service
    .from('restaurants')
    .select('slug')
    .eq('id', mesa.restaurant_id)
    .maybeSingle();

  const { t } = await getI18n();
  const asunto: Record<string, string> = {
    waiter: t.table.callWaiter,
    bill: t.table.callBill,
    water: t.table.callWater,
    help: t.table.callHelp,
  };

  await sendUserPush(mesa.assigned_waiter_id, {
    title: `${mesa.name}: ${asunto[type] ?? t.table.calls}`,
    body: t.floor.callBody.replace('{table}', mesa.name),
    url: '/dashboard/floor',
    tag: `mesa-${tableCode}`,
  });
}
