'use client';

import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import type { Enums } from '@/types/database';

export type TicketPaper = '58mm' | '80mm' | 'a4';

export type PrintSettings = {
  paper: TicketPaper;
  autoPrint: boolean;
  copies: number;
  showLogo: boolean;
  footerNote: string | null;
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: '80mm',
  autoPrint: false,
  copies: 1,
  showLogo: true,
  footerNote: null,
};

/** Ancho útil del papel, ya descontados los márgenes de la impresora. */
export const PAPER_WIDTH: Record<TicketPaper, string> = {
  '58mm': '48mm',
  '80mm': '72mm',
  a4: '190mm',
};

/** Desglose por tipo impositivo, tal y como lo congela el documento fiscal. */
export type TaxLine = { rate: number; base_cents: number; tax_cents: number };

export type TicketOrder = {
  code: string;
  type: Enums<'order_type'>;
  createdAt: string;
  tableName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  notes: string | null;
  paymentMethod: Enums<'payment_method'>;
  paymentStatus: Enums<'payment_status'>;
  currency: string;
  currencyDecimals: number;
  subtotalCents: number;
  discountCents: number;
  couponCode: string | null;
  deliveryFeeCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  /** Documento fiscal emitido, si lo hay: serie, número y desglose. */
  fiscalNumber?: string | null;
  fiscalKind?: 'simplified' | 'invoice' | 'credit_note' | null;
  taxBreakdown?: TaxLine[];
  customerTaxId?: string | null;
  customerAddress?: string | null;
  covers?: number | null;
  items: {
    name: string;
    quantity: number;
    lineTotalCents: number;
    options: string[];
    notes: string | null;
  }[];
};

/**
 * Ticket de cocina y caja.
 *
 * Se maqueta con medidas físicas (mm) y tipografía monoespaciada porque el
 * destino es una impresora térmica de rollo, no una pantalla: en 58 mm caben
 * unas 32 columnas y en 80 mm unas 48.
 */
export function Ticket({
  order,
  restaurant,
  settings,
  locale,
}: {
  order: TicketOrder;
  restaurant: {
    name: string;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
    /** Identificación fiscal del emisor: sin ella el ticket no vale como tal. */
    taxId?: string | null;
  };
  settings: PrintSettings;
  locale: string;
}) {
  const narrow = settings.paper === '58mm';
  const money = (cents: number) => formatMoney(cents, order.currency, order.currencyDecimals);

  const TYPE_LABEL: Record<Enums<'order_type'>, string> = {
    dine_in: order.tableName ?? 'MESA',
    delivery: 'DOMICILIO',
    pickup: 'RECOGIDA',
  };

  const PAY_LABEL: Record<Enums<'payment_method'>, string> = {
    cash: 'EFECTIVO',
    card: 'TARJETA',
    tpv: 'DATAFONO',
    stripe: 'TARJETA',
  };

  return (
    <div
      className="ticket font-mono text-black"
      style={{
        width: PAPER_WIDTH[settings.paper],
        fontSize: narrow ? '10px' : '11px',
        lineHeight: 1.35,
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '3mm' }}>
        {settings.showLogo && restaurant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- impresión: sin optimizador
          <img
            src={restaurant.logoUrl}
            alt=""
            style={{ width: '18mm', height: '18mm', objectFit: 'contain', margin: '0 auto 2mm' }}
          />
        )}
        <div style={{ fontSize: narrow ? '13px' : '15px', fontWeight: 700 }}>{restaurant.name}</div>
        {restaurant.taxId && <div>{restaurant.taxId}</div>}
        {restaurant.address && <div>{restaurant.address}</div>}
        {restaurant.phone && <div>{restaurant.phone}</div>}
      </div>

      <Divider />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: narrow ? '14px' : '16px' }}>
        <span>#{order.code}</span>
        <span>{TYPE_LABEL[order.type]}</span>
      </div>
      {/* El número del pedido no sirve como numeración fiscal: es un contador
          global de la plataforma. El de la serie sí, y va destacado. */}
      {order.fiscalNumber && (
        <div style={{ fontWeight: 700 }}>
          {order.fiscalKind === 'invoice'
            ? 'FACTURA'
            : order.fiscalKind === 'credit_note'
              ? 'FACTURA RECTIFICATIVA'
              : 'TICKET'}{' '}
          {order.fiscalNumber}
        </div>
      )}
      <div>{formatDateTime(order.createdAt, locale)}</div>
      {order.covers ? <div>Comensales: {order.covers}</div> : null}

      {order.customerName && <div>Cliente: {order.customerName}</div>}
      {order.customerTaxId && <div>NIF: {order.customerTaxId}</div>}
      {order.customerPhone && <div>Tel: {order.customerPhone}</div>}
      {(order.customerAddress ?? order.address) && (
        <div>Dir: {order.customerAddress ?? order.address}</div>
      )}

      <Divider />

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={`${item.name}-${index}`}>
              <td style={{ verticalAlign: 'top', paddingBottom: '1.5mm' }}>
                <div style={{ fontWeight: 700 }}>
                  {item.quantity} × {item.name}
                </div>
                {item.options.length > 0 && (
                  <div style={{ paddingLeft: '3mm' }}>+ {item.options.join(', ')}</div>
                )}
                {item.notes && (
                  <div style={{ paddingLeft: '3mm', fontWeight: 700 }}>** {item.notes}</div>
                )}
              </td>
              <td style={{ verticalAlign: 'top', textAlign: 'right', whiteSpace: 'nowrap', paddingBottom: '1.5mm' }}>
                {money(item.lineTotalCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Divider />

      <Line label="Subtotal" value={money(order.subtotalCents)} />
      {order.discountCents > 0 && (
        <Line
          label={`Descuento${order.couponCode ? ` ${order.couponCode}` : ''}`}
          value={`-${money(order.discountCents)}`}
        />
      )}
      {order.deliveryFeeCents > 0 && <Line label="Envío" value={money(order.deliveryFeeCents)} />}
      {order.taxBreakdown && order.taxBreakdown.length > 0
        ? order.taxBreakdown.map((t) => (
            <Line
              key={t.rate}
              label={`IVA ${(Number(t.rate) * 100).toFixed(0)}% s/ ${money(t.base_cents)}`}
              value={money(t.tax_cents)}
            />
          ))
        : order.taxCents > 0 && <Line label="Impuestos" value={money(order.taxCents)} />}
      {order.tipCents > 0 && <Line label="Propina" value={money(order.tipCents)} />}

      <Divider />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 700,
          fontSize: narrow ? '14px' : '16px',
        }}
      >
        <span>TOTAL</span>
        <span>{money(order.totalCents)}</span>
      </div>

      <div style={{ marginTop: '2mm' }}>
        {PAY_LABEL[order.paymentMethod]}
        {order.paymentStatus === 'paid' ? ' · PAGADO' : ' · PENDIENTE'}
      </div>

      {order.notes && (
        <>
          <Divider />
          <div style={{ fontWeight: 700 }}>NOTA: {order.notes}</div>
        </>
      )}

      {settings.footerNote && (
        <>
          <Divider />
          <div style={{ textAlign: 'center' }}>{settings.footerNote}</div>
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: '4mm', marginBottom: '8mm' }}>¡Gracias!</div>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        borderTop: '1px dashed #000',
        margin: '2mm 0',
      }}
    />
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
