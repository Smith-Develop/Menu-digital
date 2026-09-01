import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, periodEnd } from "@/lib/stripe";
import { createAdminSupabase } from "@/lib/supabase/server";
import { stripeEnv } from "@/lib/env";

/** El webhook necesita el cuerpo intacto para validar la firma. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe || !stripeEnv.webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature)
    return NextResponse.json({ error: "NO_SIGNATURE" }, { status: 400 });

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      stripeEnv.webhookSecret,
    );
  } catch {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
  }

  // service_role: el webhook llega sin sesión, así que salta RLS a propósito.
  let supabase: ReturnType<typeof createAdminSupabase>;
  try {
    supabase = createAdminSupabase();
  } catch {
    return NextResponse.json(
      { error: "SERVICE_ROLE_KEY_MISSING" },
      { status: 503 },
    );
  }

  async function activate(
    restaurantId: string,
    planId: string,
    subscriptionId: string | null,
    customerId: string | null,
  ) {
    const { data: plan } = await supabase
      .from("plans")
      .select("*")
      .eq("id", planId)
      .maybeSingle();
    if (!plan) return;

    const start = new Date();
    const end = periodEnd(start, plan.interval);

    // Cerramos el periodo anterior antes de abrir el nuevo: el índice único
    // sólo admite una suscripción viva por sujeto.
    await supabase
      .from("subscriptions")
      .update({ status: "canceled" })
      .eq("subject_type", "restaurant")
      .eq("subject_id", restaurantId)
      .in("status", ["trialing", "active", "past_due"]);

    await supabase.from("subscriptions").insert({
      subject_type: "restaurant",
      subject_id: restaurantId,
      plan_id: planId,
      status: "active",
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
    });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const restaurantId =
        session.metadata?.restaurant_id ?? session.client_reference_id;
      const planId = session.metadata?.plan_id;
      if (!restaurantId || !planId) break;

      await activate(
        restaurantId,
        planId,
        typeof session.subscription === "string" ? session.subscription : null,
        typeof session.customer === "string" ? session.customer : null,
      );

      await supabase.from("payments").insert({
        restaurant_id: restaurantId,
        plan_id: planId,
        amount_cents: session.amount_total ?? 0,
        currency: (session.currency ?? "eur").toUpperCase(),
        status: "paid",
        stripe_checkout_id: session.id,
        stripe_payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
        paid_at: new Date().toISOString(),
      });
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const subscriptionId =
        typeof invoice.subscription === "string" ? invoice.subscription : null;
      if (!subscriptionId) break;

      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      if (!subscription?.plan_id) break;

      const { data: plan } = await supabase
        .from("plans")
        .select("interval")
        .eq("id", subscription.plan_id)
        .maybeSingle();
      if (!plan) break;

      const start = new Date();
      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          current_period_start: start.toISOString(),
          current_period_end: periodEnd(start, plan.interval).toISOString(),
        })
        .eq("id", subscription.id);

      // `payments` sigue colgando de un restaurante, así que el cobro de una
      // suscripción de repartidor no tiene dónde anotarse todavía. Hoy no
      // ocurre —los planes de repartidor no pasan por Stripe— pero cuando
      // pasen habrá que darle a esa tabla el mismo sujeto que a la
      // suscripción, que es trabajo de la fase de comisiones y facturación.
      if (subscription.restaurant_id) {
        await supabase.from("payments").insert({
          restaurant_id: subscription.restaurant_id,
          subscription_id: subscription.id,
          plan_id: subscription.plan_id,
          amount_cents: invoice.amount_paid ?? 0,
          currency: (invoice.currency ?? "eur").toUpperCase(),
          status: "paid",
          stripe_invoice_id: invoice.id,
          paid_at: new Date().toISOString(),
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId =
        typeof invoice.subscription === "string" ? invoice.subscription : null;
      if (!subscriptionId) break;

      await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", subscriptionId);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      await supabase
        .from("subscriptions")
        .update({ status: "canceled", cancel_at_period_end: true })
        .eq("stripe_subscription_id", subscription.id);
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
