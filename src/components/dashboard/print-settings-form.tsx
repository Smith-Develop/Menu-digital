'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Info, Printer } from 'lucide-react';
import { Input, Select, Switch } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { updatePrintSettings } from '@/app/dashboard/actions';
import { usePrint, } from '@/components/dashboard/print/print-provider';
import type { PrintSettings, TicketPaper } from '@/components/dashboard/print/ticket';
import { useT } from '@/i18n/provider';

/**
 * Ajustes de impresión del restaurante.
 *
 * El navegador no expone las impresoras del sistema ni permite saltarse el
 * diálogo: son restricciones de seguridad. Lo que sí controlamos es el formato
 * del ticket y cuándo se lanza la impresión; para que salga directo hay que
 * abrir el panel con Chrome en modo quiosco, que es lo que explica el aviso.
 */
export function PrintSettingsForm({ initial }: { initial: PrintSettings }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { print } = usePrint();

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await updatePrintSettings({
      paper: values.paper,
      autoPrint: values.autoPrint,
      copies: values.copies,
      showLogo: values.showLogo,
      footerNote: values.footerNote,
    });
    setSaving(false);

    if (!result.ok) {
      toast(t.common.error, 'error');
      return;
    }
    toast(t.common.save, 'success');
    router.refresh();
  }

  function testPrint() {
    print({
      code: '000000',
      type: 'dine_in',
      createdAt: new Date().toISOString(),
      tableName: 'Mesa 1',
      customerName: 'Prueba',
      customerPhone: null,
      address: null,
      notes: 'Ticket de prueba',
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      currency: 'EUR',
      currencyDecimals: 2,
      subtotalCents: 2500,
      discountCents: 250,
      couponCode: 'PRUEBA10',
      deliveryFeeCents: 0,
      taxCents: 225,
      tipCents: 0,
      totalCents: 2475,
      items: [
        { name: 'Pizza Margherita', quantity: 2, lineTotalCents: 1900, options: ['33 cm'], notes: null },
        { name: 'Limonada casera', quantity: 1, lineTotalCents: 600, options: [], notes: 'Sin hielo' },
      ],
    });
  }

  return (
    <section className="space-y-5 rounded-2xl bg-white p-6 shadow-chip">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-700">
          <Printer className="h-4 w-4 text-brand" />
          {t.dashboard.printing}
        </h2>
      </div>

      <div className="flex items-start gap-3 rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p>{t.dashboard.printingHint}</p>
          <details className="mt-2">
            <summary className="cursor-pointer font-bold">{t.dashboard.kioskHelp}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
              <li>Elige la impresora de tickets como predeterminada en el sistema.</li>
              <li>Cierra Chrome por completo.</li>
              <li>
                Ábrelo con este atajo:
                <code className="mt-1 block overflow-x-auto rounded bg-white/70 px-2 py-1 font-mono text-[11px]">
                  chrome --kiosk-printing --app=https://tu-dominio/dashboard/orders
                </code>
              </li>
              <li>A partir de ahí los tickets salen sin diálogo.</li>
            </ol>
          </details>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          value={values.paper}
          onChange={(e) => setValues({ ...values, paper: e.target.value as TicketPaper })}
          label={t.dashboard.paperSize}
        >
          <option value="58mm">58 mm (térmica estrecha)</option>
          <option value="80mm">80 mm (térmica estándar)</option>
          <option value="a4">A4</option>
        </Select>

        <Input
          type="number"
          value={values.copies}
          onChange={(e) => setValues({ ...values, copies: Number(e.target.value) })}
          label={t.dashboard.copies}
          min={1}
          max={5}
        />
      </div>

      <Input
        value={values.footerNote ?? ''}
        onChange={(e) => setValues({ ...values, footerNote: e.target.value })}
        label={t.dashboard.ticketFooter}
        placeholder="Gracias por su visita · IVA incluido"
        maxLength={120}
      />

      <div className="space-y-3 rounded-xl bg-surface-field p-4">
        <Switch
          checked={values.autoPrint}
          onChange={(v) => setValues({ ...values, autoPrint: v })}
          label={t.dashboard.autoPrint}
        />
        <Switch
          checked={values.showLogo}
          onChange={(v) => setValues({ ...values, showLogo: v })}
          label={t.dashboard.showLogoOnTicket}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={save} loading={saving}>
          {t.common.save}
        </Button>
        <Button type="button" variant="ghost" onClick={testPrint}>
          <Printer className="h-4 w-4" />
          {t.dashboard.testPrint}
        </Button>
      </div>
    </section>
  );
}
