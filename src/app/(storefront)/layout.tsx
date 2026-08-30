import { getBrand } from '@/lib/brand';
import { getSessionProfile } from '@/lib/auth';
import { BottomNav } from '@/components/storefront/bottom-nav';
import { DesktopHeader } from '@/components/storefront/desktop-header';
import { SiteFooter } from '@/components/storefront/site-footer';

/**
 * Marco del escaparate.
 *
 * En móvil es la columna estrecha del diseño de Figma con su barra inferior;
 * a partir de `lg` se convierte en una página ancha con cabecera propia, que es
 * lo que se espera al abrirla en un ordenador.
 */
export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [brand, profile] = await Promise.all([getBrand(), getSessionProfile()]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface-soft">
      <DesktopHeader
        brand={{ appName: brand.appName, logoUrl: brand.logoUrl }}
        isSignedIn={Boolean(profile)}
      />

      <div className="mx-auto w-full max-w-[480px] flex-1 bg-white lg:max-w-6xl lg:bg-transparent lg:px-8 lg:py-8">
        {children}
      </div>

      <SiteFooter brand={brand} />
      <BottomNav />
    </div>
  );
}
