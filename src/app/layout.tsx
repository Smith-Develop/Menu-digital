import type { Metadata, Viewport } from 'next';
import { Open_Sans, Sen } from 'next/font/google';
import { getLocale } from '@/i18n';
import { I18nProvider } from '@/i18n/provider';
import { ToastProvider } from '@/components/ui/toast';
import { getBrand, brandCssVariables } from '@/lib/brand';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import './globals.css';

// Tipografías del diseño de Figma: Sen para titulares, Open Sans para el resto.
const sen = Sen({ subsets: ['latin'], variable: '--font-sen', display: 'swap' });
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const title = `${brand.appName} — ${brand.tagline}`;

  return {
    title: { default: title, template: `%s · ${brand.appName}` },
    description: brand.description,
    applicationName: brand.appName,
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: brand.appName },
    formatDetection: { telephone: false },
    openGraph: {
      type: 'website',
      siteName: brand.appName,
      title,
      description: brand.description,
    },
    twitter: { card: 'summary_large_image', title, description: brand.description },
    icons: {
      icon: brand.iconUrl ?? '/icon.svg',
      apple: brand.iconUrl ?? '/icon.svg',
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const brand = await getBrand();
  return {
    themeColor: brand.primaryColor,
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, brand] = await Promise.all([getLocale(), getBrand()]);

  return (
    <html
      lang={locale}
      className={`${sen.variable} ${openSans.variable}`}
      style={brandCssVariables(brand) as React.CSSProperties}
    >
      <head>
        {/*
          Chrome anuncia que la aplicación se puede instalar con un evento que
          dispara muy pronto, a menudo antes de que React haya montado nada. Si
          se espera a un efecto para escucharlo, ese aviso ya ha pasado y no
          vuelve: el botón de instalar se quedaba sin diálogo que abrir y sólo
          podía ofrecer instrucciones. Por eso se atrapa aquí, en cuanto se
          analiza el documento, y se guarda para cuando la interfaz esté lista.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__instalable = null;
              window.addEventListener('beforeinstallprompt', function (e) {
                e.preventDefault();
                window.__instalable = e;
                window.dispatchEvent(new Event('instalable'));
              });
              window.addEventListener('appinstalled', function () {
                window.__instalable = null;
              });
            `,
          }}
        />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <ToastProvider>
            {children}
            <InstallPrompt appName={brand.appName} />
          </ToastProvider>
        </I18nProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
