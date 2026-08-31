import Link from 'next/link';
import Image from 'next/image';
import { Heart, ImageIcon } from 'lucide-react';
import { getI18n } from '@/i18n';
import { getSessionProfile } from '@/lib/auth';
import { listFavorites } from '@/app/actions/favorites';
import { EmptyState } from '@/components/ui/misc';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Destacados' };

export default async function FavoritesPage() {
  const { t } = await getI18n();
  const profile = await getSessionProfile();
  const favoritos = profile ? await listFavorites() : [];

  return (
    <div className="page-enter flex-1 px-5 py-6 lg:px-0">
      <h1 className="font-display text-2xl font-bold text-ink">{t.storefront.featured}</h1>
      <p className="mt-1 text-sm text-ink-300">{t.storefront.featuredHint}</p>

      {!profile ? (
        <EmptyState
          icon={<Heart className="h-7 w-7" />}
          title={t.storefront.featuredSignIn}
          action={
            <Link href="/login" className="btn-primary mt-4">
              {t.auth.signIn}
            </Link>
          }
          className="mt-10"
        />
      ) : favoritos.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-7 w-7" />}
          title={t.storefront.featuredEmpty}
          description={t.storefront.featuredEmptyHint}
          className="mt-10"
        />
      ) : (
        <ul className="mt-6 space-y-3">
          {favoritos.map((plato) => (
            <li key={plato.id}>
              <Link
                href={plato.restaurant ? `/r/${plato.restaurant.slug}/p/${plato.id}` : '#'}
                className="flex items-center gap-4 rounded-2xl bg-white p-3 shadow-chip transition-shadow hover:shadow-card"
              >
                <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                  {plato.image ? (
                    <Image src={plato.image} alt="" fill sizes="64px" className="object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-200">
                      <ImageIcon className="h-5 w-5" />
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink-700">{plato.name}</span>
                  {plato.restaurant && (
                    <span className="block truncate text-xs text-ink-300">
                      {plato.restaurant.name}
                    </span>
                  )}
                  {!plato.available && (
                    <span className="mt-1 inline-block text-[11px] font-bold text-state-danger">
                      {t.product.unavailable}
                    </span>
                  )}
                </span>

                <span className="shrink-0 text-sm font-bold text-ink">
                  {plato.restaurant
                    ? formatMoney(
                        plato.priceCents,
                        plato.restaurant.currency,
                        plato.restaurant.currency_decimals,
                      )
                    : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
