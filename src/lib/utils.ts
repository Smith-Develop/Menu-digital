import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Slug url-safe, misma lógica que public.slugify() en Postgres. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Código legible para el QR de una mesa: "LATRAT-M07". */
export function tableCode(restaurantSlug: string, tableName: string): string {
  const prefix = slugify(restaurantSlug).replace(/-/g, '').slice(0, 6).toUpperCase();
  const suffix = slugify(tableName).replace(/-/g, '').slice(0, 6).toUpperCase();
  const salt = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${suffix}-${salt}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** "hace 3 min" / "3 min ago" */
export function relativeTime(date: string | Date, locale = 'es'): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.round((Date.now() - then.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf.format(-Math.round(value), unit);
    value /= size;
  }
  return rtf.format(-Math.round(value), 'year');
}

/** Minutos transcurridos, para el color de urgencia de los tickets de cocina. */
export function minutesSince(date: string | Date): number {
  const then = typeof date === 'string' ? new Date(date) : date;
  return Math.floor((Date.now() - then.getTime()) / 60000);
}

export function formatTime(date: string | Date, locale = 'es'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDate(date: string | Date, locale = 'es'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(date: string | Date, locale = 'es'): string {
  return `${formatDate(date, locale)} · ${formatTime(date, locale)}`;
}
