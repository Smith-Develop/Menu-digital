import type { Metadata, Viewport } from 'next';
import { Open_Sans, Sen } from 'next/font/google';
import { getLocale } from '@/i18n';
import { I18nProvider } from '@/i18n/provider';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

// Tipografías del diseño de Figma: Sen para titulares, Open Sans para el resto.
const sen = Sen({ subsets: ['latin'], variable: '--font-sen', display: 'swap' });
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'Menu Digital · Carta digital y pedidos para restaurantes',
    template: '%s · Menu Digital',
  },
  description:
    'Carta digital con QR por mesa, vista 3D de los platos, pedidos a domicilio y panel de gestión para restaurantes.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Menu Digital' },
};

export const viewport: Viewport = {
  themeColor: '#FF7622',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} className={`${sen.variable} ${openSans.variable}`}>
      <body>
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
