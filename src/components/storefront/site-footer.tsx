import Link from 'next/link';
import type { Brand } from '@/lib/brand';
import { getI18n } from '@/i18n';

/** Pie solo de escritorio: en móvil el espacio lo ocupa la barra inferior. */
export async function SiteFooter({ brand }: { brand: Brand }) {
  const { t } = await getI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto hidden border-t border-surface-line bg-white lg:block">
      <div className="mx-auto grid max-w-6xl gap-8 px-8 py-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-lg font-bold text-ink">{brand.appName}</p>
          <p className="mt-1 text-sm font-semibold text-brand">{brand.tagline}</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-300">{brand.description}</p>
        </div>

        <nav>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-300">
            {t.nav.home}
          </p>
          <ul className="space-y-2 text-sm text-ink-400">
            <li><Link href="/" className="hover:text-brand">{t.storefront.openRestaurants}</Link></li>
            <li><Link href="/search" className="hover:text-brand">{t.common.search}</Link></li>
            <li><Link href="/orders" className="hover:text-brand">{t.order.myOrders}</Link></li>
          </ul>
        </nav>

        <nav>
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-300">
            {t.footer.forBusinesses}
          </p>
          <ul className="space-y-2 text-sm text-ink-400">
            <li><Link href="/register" className="hover:text-brand">{t.auth.signUpCta}</Link></li>
            <li><Link href="/courier" className="hover:text-brand">{t.courier.becomeCourier}</Link></li>
            <li><Link href="/login" className="hover:text-brand">{t.auth.signIn}</Link></li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-surface-line px-8 py-5">
        <p className="mx-auto max-w-6xl text-xs text-ink-300">
          © {year} {brand.appName}
        </p>
      </div>
    </footer>
  );
}
