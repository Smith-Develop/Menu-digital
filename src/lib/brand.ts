import { cache } from 'react';
import { createPublicSupabase } from '@/lib/supabase/server';
import type { Tables } from '@/types/database';

export type Brand = {
  appName: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  textColor: string;
};

/** Marca por defecto: la que se ve si aún no se ha tocado nada en el panel. */
export const DEFAULT_BRAND: Brand = {
  appName: 'Yumi',
  tagline: 'Tu comida favorita, en minutos.',
  description:
    'Pide la mejor comida a domicilio con Yumi. Encuentra tus restaurantes favoritos, realiza el seguimiento en tiempo real y disfruta entregas ultra rápidas.',
  logoUrl: null,
  iconUrl: null,
  primaryColor: '#FF7622',
  accentColor: '#FFCA28',
  textColor: '#1A1817',
};

function fromRow(row: Tables<'app_settings'>): Brand {
  return {
    appName: row.app_name,
    tagline: row.tagline,
    description: row.description,
    logoUrl: row.logo_url,
    iconUrl: row.icon_url,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    textColor: row.text_color,
  };
}

/**
 * Marca configurada por el superadministrador.
 * `cache` la comparte entre todos los componentes de una misma petición.
 */
export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const supabase = createPublicSupabase();
    const { data } = await supabase.from('app_settings').select('*').eq('id', true).maybeSingle();
    return data ? fromRow(data) : DEFAULT_BRAND;
  } catch {
    // Si la base no responde, la aplicación sigue pintándose con la marca base.
    return DEFAULT_BRAND;
  }
});

/** "#FF7622" → "255 118 34", que es lo que espera `rgb(var(--x) / <alpha>)`. */
export function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '').trim();
  const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return '255 118 34';
  return `${r} ${g} ${b}`;
}

/**
 * Convierte un color de marca en las variables CSS que consume la interfaz.
 * Se inyectan como estilo en línea para que también las vean los componentes
 * cliente, que reciben el HTML ya pintado con el color correcto.
 */
export function brandCssVariables(brand: {
  primaryColor: string;
  accentColor: string;
  textColor: string;
}): Record<string, string> {
  return {
    '--brand-rgb': hexToRgbChannels(brand.primaryColor),
    '--brand-contrast': readableOn(brand.primaryColor),
    '--accent-rgb': hexToRgbChannels(brand.accentColor),
    '--accent-contrast': readableOn(brand.accentColor),
    '--ink': brand.textColor,
  };
}

/** Blanco o tinta según el contraste, para el texto encima de un color de marca. */
export function readableOn(hex: string): string {
  const clean = hex.replace('#', '');
  const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = Number.parseInt(value.slice(0, 2), 16) || 0;
  const g = Number.parseInt(value.slice(2, 4), 16) || 0;
  const b = Number.parseInt(value.slice(4, 6), 16) || 0;

  // Luminancia relativa (WCAG). Por encima de 0.55 el texto oscuro lee mejor.
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  return luminance > 0.55 ? '#1A1817' : '#FFFFFF';
}
