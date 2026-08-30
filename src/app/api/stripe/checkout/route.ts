import { NextResponse, type NextRequest } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { createServerSupabase } from '@/lib/supabase/server';
import { getStaffContext } from '@/lib/auth';
import { canManageBilling } from '@/lib/auth-permissions';
import { originFromRequest } from '@/lib/request-url';

/**
 * Abre una sesión de Stripe Checkout para renovar o cambiar de plan.
 * El importe se toma del plan en la BD, nunca del cliente.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'STRIPE_NOT_CONFIGURED' }, { status: 503 });
  }

  const context = await getStaffContext();
  if (!context) return NextResponse.json({ error: 'NOT_AUTHENTICATED' }, { status: 401 });
  if (!canManageBilling(context.staffRole)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { planId?: string };
  if (!body.planId) return NextResponse.json({ error: 'PLAN_REQUIRED' }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data: plan } = await supabase
    .from('plans')
    .select('*')
    .eq('id', body.planId)
    .eq('is_active', true)
    .maybeSingle();

  if (!plan) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 });

  const base = originFromRequest(request).replace(/\/$/, '');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: context.profile.email ?? undefined,
    client_reference_id: context.restaurant.id,
    line_items: [
      plan.stripe_price_id
        ? { price: plan.stripe_price_id, quantity: 1 }
        : {
            quantity: 1,
            price_data: {
              currency: plan.currency.toLowerCase(),
              unit_amount: plan.price_cents,
              recurring: { interval: plan.interval },
              product_data: {
                name: `${plan.name} · ${context.restaurant.name}`,
                description: plan.description ?? undefined,
              },
            },
          },
    ],
    subscription_data: {
      metadata: { restaurant_id: context.restaurant.id, plan_id: plan.id },
      ...(plan.trial_days > 0 ? { trial_period_days: plan.trial_days } : {}),
    },
    metadata: { restaurant_id: context.restaurant.id, plan_id: plan.id },
    success_url: `${base}/dashboard/subscription?payment=success`,
    cancel_url: `${base}/dashboard/subscription?payment=cancelled`,
  });

  if (!session.url) return NextResponse.json({ error: 'NO_SESSION_URL' }, { status: 500 });
  return NextResponse.json({ url: session.url });
}
