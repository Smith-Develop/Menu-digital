'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Box, Plus, Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { useActiveCart } from '@/components/storefront/cart-provider';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

type BrowserProduct = {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  priceCents: number;
  image: string | null;
  rating: number;
  has3d: boolean;
  available: boolean;
};

type BrowserCategory = { id: string; name: string; image: string | null };

/**
 * Carta navegable: filtro por categoría + buscador local.
 * Reproduce el patrón "Restaurant View" del Figma (chips + rejilla de 2 columnas).
 */
export function MenuBrowser({
  slug,
  categories,
  products,
  currency,
  currencyDecimals,
}: {
  slug: string;
  categories: BrowserCategory[];
  products: BrowserProduct[];
  currency: string;
  currencyDecimals: number;
}) {
  const t = useT();
  const toast = useToast();
  const cart = useActiveCart();
  const addLine = cart((s) => s.addLine);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return products.filter((product) => {
      if (activeCategory && product.categoryId !== activeCategory) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        (product.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [products, activeCategory, term]);

  const activeName = categories.find((c) => c.id === activeCategory)?.name ?? t.common.all;

  function quickAdd(product: BrowserProduct) {
    addLine({
      productId: product.id,
      name: product.name,
      image: product.image,
      unitPriceCents: product.priceCents,
      quantity: 1,
      options: [],
    });
    toast(t.product.addedToCart, 'success');
  }

  return (
    <>
      {/* `top-0`, no la altura de la cabecera: esta barra vive dentro del
          contenedor que hace el desplazamiento, y ese contenedor ya empieza
          debajo de la cabecera. Descontarla otra vez dejaba la barra flotando
          con un hueco blanco encima. */}
      <div className="sticky top-0 z-20 bg-white/95 px-5 py-3 backdrop-blur lg:rounded-t-sheet">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t.common.searchPlaceholder}
            aria-label={t.common.search}
            className="w-full rounded-xl bg-surface-field py-3 pl-10 pr-4 text-sm text-ink placeholder:text-ink-400 focus:bg-white focus:ring-1 focus:ring-brand/30"
          />
        </div>
      </div>

      {categories.length > 0 && (
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-4">
          <CategoryPill
            label={t.common.all}
            active={activeCategory === null}
            onClick={() => setActiveCategory(null)}
          />
          {categories.map((category) => (
            <CategoryPill
              key={category.id}
              label={category.name}
              active={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            />
          ))}
        </div>
      )}

      <div className="px-5">
        <h2 className="mb-4 font-display text-lg font-bold text-ink-700">
          {activeName} <span className="text-ink-200">({visible.length})</span>
        </h2>

        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-300">{t.common.empty}</p>
        ) : (
          <div className="stagger grid grid-cols-2 gap-x-4 gap-y-12 pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((product) => (
              <article key={product.id} className="relative pt-12">
                <Link href={`/r/${slug}/p/${product.id}`} className="block">
                  <div className="absolute -top-1 left-1/2 h-[118px] w-[118px] -translate-x-1/2 overflow-hidden rounded-full bg-surface-muted shadow-card">
                    {product.image ? (
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        sizes="118px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs font-bold text-ink-200">
                        {product.name.charAt(0)}
                      </span>
                    )}
                    {product.has3d && (
                      <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/85 text-white">
                        <Box className="h-3 w-3" />
                      </span>
                    )}
                  </div>

                  <div
                    className={cn(
                      'rounded-2xl bg-white px-3.5 pb-3.5 pt-[68px] shadow-chip',
                      !product.available && 'opacity-60',
                    )}
                  >
                    <p className="line-clamp-1 text-[15px] font-bold text-ink-700">{product.name}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-ink-300">
                      {product.description ?? ''}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="text-base font-bold text-ink">
                        {formatMoney(product.priceCents, currency, currencyDecimals)}
                      </span>
                    </div>
                  </div>
                </Link>

                <button
                  type="button"
                  onClick={() => quickAdd(product)}
                  disabled={!product.available}
                  aria-label={t.product.addToCart}
                  className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_14px_-6px_rgba(255,118,34,0.9)] disabled:bg-ink-200 lg:transition-transform lg:active:scale-95"
                >
                  <Plus className="h-4 w-4" strokeWidth={3} />
                </button>

                {!product.available && (
                  <span className="absolute right-3 top-14 rounded-full bg-ink/80 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    {t.product.unavailable}
                  </span>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-pill px-5 py-2.5 text-[13px] font-bold capitalize transition-colors',
        active
          ? 'bg-brand text-white shadow-[0_8px_18px_-10px_rgba(255,118,34,1)]'
          : 'border border-surface-line bg-white text-ink-600 hover:border-brand hover:text-brand',
      )}
    >
      {label}
    </button>
  );
}
