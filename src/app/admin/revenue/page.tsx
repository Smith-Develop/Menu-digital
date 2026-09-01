import { getI18n } from '@/i18n';
import { requireSuperadmin } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { PlatformRevenuePanel, type PlatformRevenue } from '@/components/admin/platform-revenue';
import { PlatformBilling, type SettlementRow } from '@/components/admin/platform-billing';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ingresos' };

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSuperadmin();
  const { t } = await getI18n();
  const { days } = await searchParams;

  const supabase = await createServerSupabase();
  const [{ data }, { data: cfg }, { data: liquidaciones }] = await Promise.all([
    supabase.rpc('platform_revenue', {
      p_days: Math.min(Math.max(Number(days) || 30, 1), 365),
    }),
    supabase
      .from('app_settings')
      .select('legal_name, tax_id, fiscal_address, invoice_series, invoice_note')
      .maybeSingle(),
    supabase
      .from('platform_settlements')
      .select('*')
      .order('settled_at', { ascending: false })
      .limit(20),
  ]);

  // Nombre del sujeto y factura de cada liquidación: dos consultas más porque
  // los tipos generados no llevan relaciones y el anidado no se puede inferir.
  const ids = (liquidaciones ?? []).map((l) => l.subject_id);
  const [{ data: locales }, { data: repartidores }, { data: facturas }] = await Promise.all([
    ids.length ? supabase.from('restaurants').select('id, name').in('id', ids) : { data: [] },
    ids.length ? supabase.from('couriers').select('id, user_id').in('id', ids) : { data: [] },
    ids.length
      ? supabase.from('platform_invoices').select('settlement_id, full_number').in('subject_id', ids)
      : { data: [] },
  ]);

  const perfiles = (repartidores ?? []).length
    ? (
        await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', (repartidores ?? []).map((c) => c.user_id))
      ).data
    : [];

  const nombreLocal = new Map((locales ?? []).map((r) => [r.id, r.name]));
  const nombreRepartidor = new Map(
    (repartidores ?? []).map((c) => {
      const persona = (perfiles ?? []).find((p) => p.id === c.user_id);
      return [c.id, persona?.full_name ?? persona?.email ?? '—'];
    }),
  );
  const facturaPor = new Map(
    (facturas ?? []).map((f) => [f.settlement_id, f.full_number]),
  );

  const filas: SettlementRow[] = (liquidaciones ?? []).map((l) => ({
    id: l.id,
    subjectType: l.subject_type as 'restaurant' | 'courier',
    name:
      l.subject_type === 'restaurant'
        ? (nombreLocal.get(l.subject_id) ?? '—')
        : (nombreRepartidor.get(l.subject_id) ?? '—'),
    lines: l.lines,
    amountCents: l.amount_cents,
    currency: l.currency,
    settledAt: l.settled_at,
    invoiceNumber: facturaPor.get(l.id) ?? null,
  }));

  const vacio: PlatformRevenue = {
    fees_cents: 0,
    fees_count: 0,
    commission_cents: 0,
    commission_base_cents: 0,
    commission_restaurants_cents: 0,
    commission_couriers_cents: 0,
    pending_cents: 0,
    active_subscriptions: 0,
    paying_restaurants: 0,
    paying_couriers: 0,
    top_restaurants: [],
    pending_by_subject: [],
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t.admin.platformIncome}</h1>
        <p className="mt-1 text-sm text-ink-300">{t.admin.revenueHint}</p>
      </div>

      <PlatformRevenuePanel
        data={(data as unknown as PlatformRevenue | null) ?? vacio}
        // La plataforma factura en una sola divisa; la de cada local es asunto
        // suyo y no se mezcla con esto.
        currency="EUR"
      />

      <PlatformBilling
        billing={{
          legalName: cfg?.legal_name ?? null,
          taxId: cfg?.tax_id ?? null,
          fiscalAddress: cfg?.fiscal_address ?? null,
          invoiceSeries: cfg?.invoice_series ?? 'P',
          invoiceNote: cfg?.invoice_note ?? null,
        }}
        settlements={filas}
      />
    </div>
  );
}
