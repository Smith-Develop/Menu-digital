import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { pushEnv } from '@/lib/env';

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  citySlug: z.string().optional().nullable(),
  locale: z.string().optional(),
  orderId: z.string().uuid().optional(),
});

/**
 * Da de alta el dispositivo y, si se indica, lo ata a un pedido concreto.
 *
 * El vínculo con el pedido es lo que permite avisar a quien pidió desde una
 * mesa sin registrarse. Se escribe con la clave de servicio porque el visitante
 * es anónimo y no puede tener permiso de escritura sobre estas tablas: dárselo
 * abriría la puerta a que cualquiera se suscribiese a los pedidos de otro.
 */
export async function POST(request: Request) {
  if (!pushEnv.isConfigured) {
    return NextResponse.json({ error: 'PUSH_NOT_CONFIGURED' }, { status: 503 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  const { endpoint, keys, citySlug, locale, orderId } = parsed.data;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const service = createAdminSupabase();

  const { data: subscription, error } = await service
    .from('push_subscriptions')
    .upsert(
      {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_id: user?.id ?? null,
        city_slug: citySlug ?? null,
        locale: locale ?? 'es',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )
    .select('id')
    .single();

  if (error || !subscription) {
    return NextResponse.json({ error: error?.message ?? 'FAILED' }, { status: 500 });
  }

  if (orderId) {
    // Sólo se acepta el vínculo si el pedido existe; el id es un uuid, así que
    // no es adivinable, y sin esta comprobación se podrían crear filas huérfanas.
    const { data: order } = await service
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .maybeSingle();

    if (order) {
      await service
        .from('order_push_targets')
        .upsert({ order_id: orderId, subscription_id: subscription.id }, { onConflict: 'order_id,subscription_id' });
    }
  }

  return NextResponse.json({ ok: true });
}

/** Baja del dispositivo cuando el usuario desactiva los avisos. */
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = (body as { endpoint?: string } | null)?.endpoint;
  if (!endpoint) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });

  const service = createAdminSupabase();
  await service.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return NextResponse.json({ ok: true });
}
