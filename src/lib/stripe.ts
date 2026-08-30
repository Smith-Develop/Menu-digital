import 'server-only';
import Stripe from 'stripe';
import { stripeEnv } from '@/lib/env';

let client: Stripe | null = null;

/** Cliente de Stripe, o null si la instalación aún no tiene claves. */
export function getStripe(): Stripe | null {
  if (!stripeEnv.isConfigured) return null;
  client ??= new Stripe(stripeEnv.secretKey, { apiVersion: '2025-02-24.acacia' });
  return client;
}

/** Cuánto dura un periodo según la periodicidad del plan. */
export function periodEnd(from: Date, interval: 'month' | 'year'): Date {
  const end = new Date(from);
  if (interval === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}
