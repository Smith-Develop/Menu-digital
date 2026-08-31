import 'server-only';

import webpush from 'web-push';
import { pushEnv } from '@/lib/env';
import { createAdminSupabase } from '@/lib/supabase/server';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

let configured = false;

function ready(): boolean {
  if (!pushEnv.isConfigured) return false;
  if (!configured) {
    webpush.setVapidDetails(pushEnv.subject, pushEnv.publicKey, pushEnv.privateKey);
    configured = true;
  }
  return true;
}

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Envía a un conjunto de dispositivos y limpia los que ya no existen.
 *
 * Un endpoint caducado responde 404 o 410; si no se borra, la tabla se llena de
 * dispositivos muertos y cada aviso tarda más. El resto de errores se ignoran:
 * que un móvil esté ilocalizable no puede tumbar el cambio de estado de un
 * pedido, que es lo que ha disparado el aviso.
 */
async function deliver(subscriptions: Subscription[], payload: PushPayload): Promise<number> {
  if (!ready() || subscriptions.length === 0) return 0;

  const body = JSON.stringify(payload);
  const stale: string[] = [];
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) stale.push(subscription.id);
        else console.error('[push] envío rechazado', status, (error as Error).message);
      }
    }),
  );

  if (stale.length) {
    const service = createAdminSupabase();
    await service.from('push_subscriptions').delete().in('id', stale);
  }

  return sent;
}

/**
 * Avisa a quien hizo el pedido: tanto si tiene cuenta como si lo hizo desde una
 * mesa sin registrarse, en cuyo caso el vínculo está en `order_push_targets`.
 */
export async function sendOrderPush(orderId: string, payload: PushPayload): Promise<number> {
  if (!pushEnv.isConfigured) return 0;
  const service = createAdminSupabase();

  const { data: order } = await service
    .from('orders')
    .select('customer_id')
    .eq('id', orderId)
    .maybeSingle();

  const found = new Map<string, Subscription>();

  if (order?.customer_id) {
    const { data } = await service
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', order.customer_id);
    for (const row of data ?? []) found.set(row.id, row);
  }

  // Dos consultas en vez de un join anidado: así el aviso no depende de que
  // PostgREST tenga cargada la relación entre ambas tablas.
  const { data: targets } = await service
    .from('order_push_targets')
    .select('subscription_id')
    .eq('order_id', orderId);

  const ids = (targets ?? []).map((row) => row.subscription_id);
  if (ids.length) {
    const { data } = await service
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('id', ids);
    for (const row of data ?? []) found.set(row.id, row);
  }

  return deliver([...found.values()], payload);
}

/** Avisa a los dispositivos de una persona concreta. */
export async function sendUserPush(userId: string, payload: PushPayload): Promise<number> {
  if (!pushEnv.isConfigured) return 0;
  const service = createAdminSupabase();

  const { data } = await service
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  return deliver(data ?? [], payload);
}

/** Avisos del superadmin: a todo el mundo o sólo a determinadas ciudades. */
export async function sendBroadcastPush(
  payload: PushPayload,
  cities: string[] | null,
): Promise<number> {
  if (!pushEnv.isConfigured) return 0;
  const service = createAdminSupabase();

  let query = service.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  if (cities?.length) query = query.in('city_slug', cities);

  const { data } = await query;
  return deliver(data ?? [], payload);
}
