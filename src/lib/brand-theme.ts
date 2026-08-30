/**
 * Utilidades de color de la marca.
 *
 * Viven aparte de `lib/brand.ts` porque ese módulo consulta la base de datos y
 * arrastra `next/headers`: los componentes cliente que solo necesitan pintar
 * una vista previa no pueden importarlo.
 */

export type BrandColors = {
  primaryColor: string;
  accentColor: string;
  textColor: string;
};

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

/**
 * Convierte un color de marca en las variables CSS que consume la interfaz.
 * Se inyectan como estilo en línea para que también las vean los componentes
 * cliente, que reciben el HTML ya pintado con el color correcto.
 */
export function brandCssVariables(brand: BrandColors): Record<string, string> {
  return {
    '--brand-rgb': hexToRgbChannels(brand.primaryColor),
    '--brand-contrast': readableOn(brand.primaryColor),
    '--accent-rgb': hexToRgbChannels(brand.accentColor),
    '--accent-contrast': readableOn(brand.accentColor),
    '--ink': brand.textColor,
  };
}
