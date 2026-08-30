import type { Config } from 'tailwindcss';

/**
 * Tokens extraídos del Figma "menu-app" (file TVU2oHj08Qkm5WqEI5JRK7).
 * Variables del archivo: Shade/4 #1A1817 · Shade/1 #403F3E · Tint/1 #FAF7F5
 * Tint/2 #F0ECE9 · Tint/3 #E3DCD5 · Tint/7 #B0A9A2 · Star-Dark #DFB300
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        /**
         * El color de marca es configurable desde el panel de superadministración
         * y cada restaurante puede tener el suyo, así que sale de variables CSS.
         * `--brand-rgb` va en canales sueltos para que `bg-brand/20` siga
         * funcionando; las escalas se derivan con color-mix sobre ese mismo tono.
         */
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          50: 'color-mix(in srgb, rgb(var(--brand-rgb)) 10%, white)',
          100: 'color-mix(in srgb, rgb(var(--brand-rgb)) 20%, white)',
          200: 'color-mix(in srgb, rgb(var(--brand-rgb)) 38%, white)',
          300: 'color-mix(in srgb, rgb(var(--brand-rgb)) 58%, white)',
          400: 'color-mix(in srgb, rgb(var(--brand-rgb)) 78%, white)',
          500: 'rgb(var(--brand-rgb) / <alpha-value>)',
          600: 'color-mix(in srgb, rgb(var(--brand-rgb)) 92%, black)',
          700: 'color-mix(in srgb, rgb(var(--brand-rgb)) 80%, black)',
          800: 'color-mix(in srgb, rgb(var(--brand-rgb)) 64%, black)',
          900: 'color-mix(in srgb, rgb(var(--brand-rgb)) 48%, black)',
          contrast: 'var(--brand-contrast, #ffffff)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          soft: 'color-mix(in srgb, rgb(var(--accent-rgb)) 42%, white)',
          dark: 'color-mix(in srgb, rgb(var(--accent-rgb)) 84%, black)',
          contrast: 'var(--accent-contrast, #1A1817)',
        },
        ink: {
          DEFAULT: 'var(--ink, #1A1817)', // Shade/4, configurable desde el panel
          700: '#32343E',
          600: '#403F3E', // Shade/1
          500: '#646982',
          400: '#676767',
          300: '#8A837D',
          200: '#B0A9A2', // Tint/7
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FAF7F5', // Tint/1
          muted: '#F0ECE9', // Tint/2
          line: '#E3DCD5', // Tint/3
          field: '#F0F5FA', // inputs / bloques del perfil
        },
        state: {
          success: '#059669',
          warning: '#D97706',
          danger: '#EF4444',
          info: '#2563EB',
        },
      },
      fontFamily: {
        sans: ['var(--font-open-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-sen)', 'var(--font-open-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        pill: '50px',
        sheet: '24px',
        screen: '32px',
      },
      boxShadow: {
        chip: '12px 12px 30px 0px rgba(150, 150, 154, 0.15)',
        'chip-active': '0px 10px 30px 0px #EFE6E1',
        card: '0px 12px 30px -12px rgba(26, 24, 23, 0.18)',
        sheet: '0px -8px 30px 0px rgba(26, 24, 23, 0.08)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.85)', opacity: '1' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'slide-up': 'slide-up 0.28s cubic-bezier(0.32, 0.72, 0, 1) both',
        'pulse-ring': 'pulseRing 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
