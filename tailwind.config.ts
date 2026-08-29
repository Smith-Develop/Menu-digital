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
        brand: {
          DEFAULT: '#FF7622', // botones primarios (ADD TO CART, PLACE ORDER)
          50: '#FFF3EC',
          100: '#FFE3D1',
          200: '#FFC7A3',
          300: '#FFA871',
          400: '#FF8B44',
          500: '#FF7622',
          600: '#FC6E2A', // "DELIVER TO", enlaces de acento
          700: '#E2560E',
          800: '#B7440C',
          900: '#8A340A',
        },
        accent: {
          DEFAULT: '#FFCA28', // chip de categoría activa, botón bolsa
          soft: '#FFE9A8',
          dark: '#DFB300', // Star-Dark
        },
        ink: {
          DEFAULT: '#1A1817', // Shade/4
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
