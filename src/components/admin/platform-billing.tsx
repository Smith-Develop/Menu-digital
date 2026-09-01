'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FileText, Receipt } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updatePlatformBilling, issuePlatformInvoice } from '@/app/admin/actions';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { useI18n } from '@/i18n/provider';

export type Billing = {
  legalName: string | null;
  taxId: string | null;
  fiscalAddress: string | null;
  invoiceSeries: string;
  invoiceNote: string | null;
};

export type SettlementRow = {
  id: string;
  subjectType: 'restaurant' | 'courier';
  name: string;
  lines: number;
  amountCents: number;
  currency: string;
  settledAt: string;
  invoiceNumber: string | null;
};

/**
 * Los datos con los que la plataforma factura, y las facturas emitidas.
 *
 * Van con los ingresos y no con la marca porque no son apariencia: sin
 * identificación fiscal del emisor no hay factura que valga, y la base se niega
 * a emitirla. El aviso se enseña arriba para que no haya que descubrirlo al
 * pulsar el botón.
 */
export function PlatformBilling({
  billing,
  settlements,
}: {
  billing: Billing;
  settlements: SettlementRow[];
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();

  const [values, setValues] = useState(billing);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);

  const listo = Boolean(values.taxId?.trim());

  async function guardar() {
    setSaving(true);
    const result = await updatePlatformBilling({
      legal_name: values.legalName?.trim() || null,
      tax_id: values.taxId?.trim() || null,
      fiscal_address: values.fiscalAddress?.trim() || null,
      invoice_series: values.invoiceSeries.trim() || 'P',
      invoice_note: values.invoiceNote?.trim() || null,
    });
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  async function emitir(row: SettlementRow) {
    setIssuing(row.id);
    const result = await issuePlatformInvoice(row.id);
    setIssuing(null);

    if (!result.ok) {
      toast(
        result.error === 'PLATFORM_TAX_ID_MISSING' ? t.admin.taxIdMissing : t.common.error,
        'error',
      );
      return;
    }
    toast(`${t.admin.invoiceIssued}: ${result.data.fullNumber}`, 'success');
    router.refresh();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <Receipt className="h-4 w-4 text-ink-300" />
          {t.admin.billingData}
        </h2>
        <p className="mb-4 mt-1 text-xs text-ink-300">{t.admin.billingHint}</p>

        {!listo && (
          <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
            {t.admin.taxIdMissing}
          </p>
        )}

        <div className="space-y-4">
          <Input
            label={t.admin.legalName}
            value={values.legalName ?? ''}
            onChange={(e) => setValues({ ...values, legalName: e.target.value })}
            placeholder="Yumi Tecnología SL"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t.admin.taxId}
              value={values.taxId ?? ''}
              onChange={(e) => setValues({ ...values, taxId: e.target.value })}
            />
            <Input
              label={t.admin.invoiceSeries}
              hint={t.admin.invoiceSeriesHint}
              value={values.invoiceSeries}
              onChange={(e) => setValues({ ...values, invoiceSeries: e.target.value })}
              maxLength={8}
            />
          </div>
          <Input
            label={t.admin.fiscalAddress}
            value={values.fiscalAddress ?? ''}
            onChange={(e) => setValues({ ...values, fiscalAddress: e.target.value })}
          />
          <Input
            label={t.admin.invoiceNote}
            hint={t.admin.invoiceNoteHint}
            value={values.invoiceNote ?? ''}
            onChange={(e) => setValues({ ...values, invoiceNote: e.target.value })}
          />
        </div>

        <div className="mt-5">
          <Button loading={saving} onClick={guardar}>
            {t.common.save}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-chip">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <FileText className="h-4 w-4 text-ink-300" />
          {t.admin.settlements}
        </h2>
        <p className="mb-3 mt-1 text-xs text-ink-300">{t.admin.settlementsHint}</p>

        {settlements.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-300">{t.admin.noSettlements}</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {settlements.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-700">
                    {row.name}
                  </span>
                  <span className="block text-xs text-ink-300">
                    {formatDateTime(row.settledAt, locale)} · {row.lines} {t.admin.lines}
                  </span>
                </span>

                <span className="shrink-0 font-display text-sm font-bold tabular-nums text-ink">
                  {formatMoney(row.amountCents, row.currency)}
                </span>

                {row.invoiceNumber ? (
                  <span className="shrink-0 rounded-md bg-surface-field px-2 py-1 font-mono text-[11px] font-bold text-ink-500">
                    {row.invoiceNumber}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => emitir(row)}
                    disabled={issuing === row.id}
                    className="btn-soft shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {t.admin.issueInvoice}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
