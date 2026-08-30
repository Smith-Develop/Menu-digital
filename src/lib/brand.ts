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

// Las utilidades de color viven en brand-theme.ts para que los componentes
// cliente puedan usarlas sin arrastrar las APIs de servidor de este módulo.
export { brandCssVariables, readableOn, hexToRgbChannels } from '@/lib/brand-theme';
export type { BrandColors } from '@/lib/brand-theme';
