/**
 * Dinero.
 *
 * Todo importe se guarda en la BD como entero en la unidad menor de la divisa
 * ("minor units"): 12,50 € → 1250. Cuántos decimales tiene esa unidad depende
 * de la divisa (EUR = 2, COP y JPY = 0, KWD = 3), por eso cada restaurante
 * guarda `currency` y `currency_decimals`.
 *
 * El formato por defecto es europeo — coma decimal y punto de millares —
 * independientemente de la divisa elegida.
 */

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
};

/** Divisas soportadas al dar de alta un restaurante. */
export const CURRENCIES: Currency[] = [
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'USD', name: 'Dólar estadounidense', symbol: '$', decimals: 2 },
  { code: 'GBP', name: 'Libra esterlina', symbol: '£', decimals: 2 },
  { code: 'CHF', name: 'Franco suizo', symbol: 'CHF', decimals: 2 },
  { code: 'MXN', name: 'Peso mexicano', symbol: '$', decimals: 2 },
  { code: 'COP', name: 'Peso colombiano', symbol: '$', decimals: 0 },
  { code: 'ARS', name: 'Peso argentino', symbol: '$', decimals: 2 },
  { code: 'CLP', name: 'Peso chileno', symbol: '$', decimals: 0 },
  { code: 'PEN', name: 'Sol peruano', symbol: 'S/', decimals: 2 },
  { code: 'UYU', name: 'Peso uruguayo', symbol: '$', decimals: 2 },
  { code: 'BOB', name: 'Boliviano', symbol: 'Bs', decimals: 2 },
  { code: 'PYG', name: 'Guaraní', symbol: '₲', decimals: 0 },
  { code: 'BRL', name: 'Real brasileño', symbol: 'R$', decimals: 2 },
  { code: 'CRC', name: 'Colón costarricense', symbol: '₡', decimals: 2 },
  { code: 'GTQ', name: 'Quetzal', symbol: 'Q', decimals: 2 },
  { code: 'HNL', name: 'Lempira', symbol: 'L', decimals: 2 },
  { code: 'NIO', name: 'Córdoba', symbol: 'C$', decimals: 2 },
  { code: 'PAB', name: 'Balboa', symbol: 'B/.', decimals: 2 },
  { code: 'DOP', name: 'Peso dominicano', symbol: 'RD$', decimals: 2 },
  { code: 'CUP', name: 'Peso cubano', symbol: '$', decimals: 2 },
  { code: 'VES', name: 'Bolívar', symbol: 'Bs.', decimals: 2 },
  { code: 'CAD', name: 'Dólar canadiense', symbol: '$', decimals: 2 },
  { code: 'AUD', name: 'Dólar australiano', symbol: '$', decimals: 2 },
  { code: 'NZD', name: 'Dólar neozelandés', symbol: '$', decimals: 2 },
  { code: 'JPY', name: 'Yen japonés', symbol: '¥', decimals: 0 },
  { code: 'CNY', name: 'Yuan chino', symbol: '¥', decimals: 2 },
  { code: 'KRW', name: 'Won surcoreano', symbol: '₩', decimals: 0 },
  { code: 'INR', name: 'Rupia india', symbol: '₹', decimals: 2 },
  { code: 'IDR', name: 'Rupia indonesia', symbol: 'Rp', decimals: 2 },
  { code: 'PHP', name: 'Peso filipino', symbol: '₱', decimals: 2 },
  { code: 'THB', name: 'Baht tailandés', symbol: '฿', decimals: 2 },
  { code: 'VND', name: 'Dong vietnamita', symbol: '₫', decimals: 0 },
  { code: 'SGD', name: 'Dólar de Singapur', symbol: '$', decimals: 2 },
  { code: 'MYR', name: 'Ringgit', symbol: 'RM', decimals: 2 },
  { code: 'AED', name: 'Dírham (EAU)', symbol: 'د.إ', decimals: 2 },
  { code: 'SAR', name: 'Riyal saudí', symbol: '﷼', decimals: 2 },
  { code: 'ILS', name: 'Séquel', symbol: '₪', decimals: 2 },
  { code: 'TRY', name: 'Lira turca', symbol: '₺', decimals: 2 },
  { code: 'EGP', name: 'Libra egipcia', symbol: 'E£', decimals: 2 },
  { code: 'MAD', name: 'Dírham marroquí', symbol: 'DH', decimals: 2 },
  { code: 'ZAR', name: 'Rand', symbol: 'R', decimals: 2 },
  { code: 'NGN', name: 'Naira', symbol: '₦', decimals: 2 },
  { code: 'KES', name: 'Chelín keniano', symbol: 'KSh', decimals: 2 },
  { code: 'PLN', name: 'Zloty', symbol: 'zł', decimals: 2 },
  { code: 'CZK', name: 'Corona checa', symbol: 'Kč', decimals: 2 },
  { code: 'HUF', name: 'Forinto', symbol: 'Ft', decimals: 2 },
  { code: 'RON', name: 'Leu rumano', symbol: 'lei', decimals: 2 },
  { code: 'BGN', name: 'Lev', symbol: 'лв', decimals: 2 },
  { code: 'SEK', name: 'Corona sueca', symbol: 'kr', decimals: 2 },
  { code: 'NOK', name: 'Corona noruega', symbol: 'kr', decimals: 2 },
  { code: 'DKK', name: 'Corona danesa', symbol: 'kr', decimals: 2 },
  { code: 'ISK', name: 'Corona islandesa', symbol: 'kr', decimals: 0 },
  { code: 'UAH', name: 'Grivna', symbol: '₴', decimals: 2 },
  { code: 'KWD', name: 'Dinar kuwaití', symbol: 'د.ك', decimals: 3 },
  { code: 'BHD', name: 'Dinar bareiní', symbol: '.د.ب', decimals: 3 },
  { code: 'TND', name: 'Dinar tunecino', symbol: 'د.ت', decimals: 3 },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string | null | undefined): Currency {
  return BY_CODE.get((code ?? 'EUR').toUpperCase()) ?? CURRENCIES[0];
}

export function currencyDecimals(code: string | null | undefined): number {
  return getCurrency(code).decimals;
}

/** Locale de formato: coma decimal y punto de millares en todas las divisas. */
const FORMAT_LOCALE = 'es-ES';

/**
 * 1250 + EUR → "12,50 €" · 12500 + COP → "12.500 $"
 * `decimals` permite forzar los decimales que tenga guardados el restaurante.
 */
export function formatMoney(
  minorUnits: number | null | undefined,
  currencyCode: string | null | undefined = 'EUR',
  decimals?: number | null,
): string {
  const currency = getCurrency(currencyCode);
  const fractionDigits = decimals ?? currency.decimals;
  const amount = (minorUnits ?? 0) / 10 ** fractionDigits;

  try {
    return new Intl.NumberFormat(FORMAT_LOCALE, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    // Divisa que este runtime no conoce: formateamos el número y añadimos el símbolo.
    const n = new Intl.NumberFormat(FORMAT_LOCALE, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
    return `${n} ${currency.symbol}`;
  }
}

/** Sin símbolo, para inputs y tablas: 1250 → "12,50" */
export function formatAmount(minorUnits: number, decimals = 2): string {
  return new Intl.NumberFormat(FORMAT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(minorUnits / 10 ** decimals);
}

/** "12,50" o "12.50" → 1250. Acepta ambos separadores para no pelearse con el teclado. */
export function parseAmount(input: string, decimals = 2): number {
  const normalized = input
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10 ** decimals);
}
