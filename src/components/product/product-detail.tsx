'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Bike, Box, ChevronLeft, Clock, Flame, Heart, ImageIcon } from 'lucide-react';
import { DishViewer3D } from '@/components/product/dish-viewer-3d';
import { QuantityStepper, Rating, Badge } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { type CartOption } from '@/lib/cart';
import { useActiveCart } from '@/components/storefront/cart-provider';
import { toggleFavorite } from '@/app/actions/favorites';
import { formatMoney } from '@/lib/money';
import { useT, interpolate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

type Option = { id: string; name: string; priceDeltaCents: number; isDefault: boolean };
type OptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: Option[];
};

export type DetailProduct = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  image: string | null;
  gallery: string[];
  model3dUrl: string | null;
  modelArUrl: string | null;
  modelScale: number;
  prepMinutes: number;
  calories: number | null;
  ingredients: string[];
  allergens: string[];
  rating: number;
  ratingCount: number;
  available: boolean;
  optionGroups: OptionGroup[];
};

export function ProductDetail({
  slug,
  restaurantName,
  restaurantLogo,
  currency,
  currencyDecimals,
  product,
  isFavorite = false,
}: {
  slug: string;
  restaurantName: string;
  restaurantLogo: string | null;
  currency: string;
  currencyDecimals: number;
  product: DetailProduct;
  /** Si esa persona ya lo tenía guardado; lo resuelve el servidor. */
  isFavorite?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const cart = useActiveCart();
  const addLine = cart((s) => s.addLine);

  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [favorite, setFavorite] = useState(isFavorite);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [mode, setMode] = useState<'photo' | '3d'>('photo');

  async function saveFavorite() {
    setSavingFavorite(true);
    // Se pinta antes de confirmar: el corazón tiene que responder al dedo, y si
    // el guardado falla se devuelve a su sitio.
    const deseado = !favorite;
    setFavorite(deseado);

    const result = await toggleFavorite(product.id);
    setSavingFavorite(false);

    if (!result.ok) {
      setFavorite(!deseado);
      if (result.error === 'SIGN_IN_REQUIRED') {
        toast(t.storefront.featuredSignIn, 'info');
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      toast(t.common.error, 'error');
    }
  }

  // Preselección: las opciones marcadas por defecto en el panel del restaurante.
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const group of product.optionGroups) {
      const defaults = group.options.filter((o) => o.isDefault).map((o) => o.id);
      initial[group.id] = defaults.slice(0, Math.max(group.maxSelect, 1));
    }
    return initial;
  });

  const chosenOptions = useMemo<CartOption[]>(() => {
    const result: CartOption[] = [];
    for (const group of product.optionGroups) {
      for (const id of selected[group.id] ?? []) {
        const option = group.options.find((o) => o.id === id);
        if (option) {
          result.push({
            id: option.id,
            group: group.name,
            name: option.name,
            priceDeltaCents: option.priceDeltaCents,
          });
        }
      }
    }
    return result;
  }, [selected, product.optionGroups]);

  const unitTotal =
    product.priceCents + chosenOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  const total = unitTotal * quantity;

  const missingRequired = product.optionGroups.filter(
    (group) => group.required && (selected[group.id]?.length ?? 0) < Math.max(group.minSelect, 1),
  );

  function toggleOption(group: OptionGroup, optionId: string) {
    setSelected((current) => {
      const now = current[group.id] ?? [];
      const isSelected = now.includes(optionId);

      if (group.maxSelect <= 1) {
        return { ...current, [group.id]: isSelected && !group.required ? [] : [optionId] };
      }
      if (isSelected) {
        return { ...current, [group.id]: now.filter((id) => id !== optionId) };
      }
      if (now.length >= group.maxSelect) return current;
      return { ...current, [group.id]: [...now, optionId] };
    });
  }

  function handleAdd() {
    if (missingRequired.length > 0) {
      toast(`${t.product.required}: ${missingRequired.map((g) => g.name).join(', ')}`, 'error');
      return;
    }
    addLine({
      productId: product.id,
      name: product.name,
      image: product.image,
      unitPriceCents: product.priceCents,
      quantity,
      options: chosenOptions,
      notes: notes.trim() || undefined,
    });
    toast(t.product.addedToCart, 'success');
    router.push(`/r/${slug}/cart`);
  }

  const has3d = Boolean(product.model3dUrl);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Ni cabecera propia ni título: el botón de volver y el nombre de la
          sección viven en la cabecera de la tienda, que es la que se ve arriba
          en todas las pantallas. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {/* Visor: foto o 3D según el conmutador */}
        <div className="relative h-[220px] w-full overflow-hidden rounded-2xl bg-surface-muted">
          {mode === '3d' && has3d ? (
            <DishViewer3D
              modelUrl={product.model3dUrl}
              iosModelUrl={product.modelArUrl}
              poster={product.image}
              alt={product.name}
              scale={product.modelScale}
              className="h-full w-full"
              compact
            />
          ) : product.image ? (
            <Image
              src={product.image}
              alt={product.name}
              fill
              priority
              sizes="(max-width: 480px) 100vw, 440px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-200">
              <ImageIcon className="h-9 w-9" />
            </div>
          )}

          <button
            type="button"
            onClick={saveFavorite}
            disabled={savingFavorite}
            aria-label={t.product.favorite}
            aria-pressed={favorite}
            className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-chip backdrop-blur transition-transform active:scale-95"
          >
            <Heart className={cn('h-5 w-5', favorite ? 'fill-brand text-brand' : 'text-ink-400')} />
          </button>

          {has3d && (
            <div className="absolute right-3 top-3 flex gap-1.5 rounded-full bg-white/90 p-1 shadow-chip backdrop-blur">
              <ModeButton active={mode === 'photo'} onClick={() => setMode('photo')}>
                <ImageIcon className="h-4 w-4" />
              </ModeButton>
              <ModeButton active={mode === '3d'} onClick={() => setMode('3d')}>
                <Box className="h-4 w-4" />
              </ModeButton>
            </div>
          )}
        </div>

        {has3d && (
          <button
            type="button"
            onClick={() => setShowViewer(true)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand-50 py-3 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
          >
            <Box className="h-4 w-4" />
            {t.product.viewAr}
          </button>
        )}

        <div className="mt-5 inline-flex items-center gap-2.5 rounded-pill border border-surface-line py-1.5 pl-1.5 pr-4">
          <span className="relative h-7 w-7 overflow-hidden rounded-full bg-surface-muted">
            {restaurantLogo && (
              <Image src={restaurantLogo} alt={restaurantName} fill sizes="28px" className="object-cover" />
            )}
          </span>
          <span className="text-sm font-semibold text-ink-600">{restaurantName}</span>
        </div>

        <h2 className="mt-4 font-display text-2xl font-bold text-ink">{product.name}</h2>
        {product.description && (
          <p className="mt-2 text-sm leading-relaxed text-ink-300">{product.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          {product.rating > 0 && <Rating value={product.rating} count={product.ratingCount} />}
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
            <Bike className="h-4 w-4 text-brand" />
            {t.common.free}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
            <Clock className="h-4 w-4 text-brand" />
            {product.prepMinutes} {t.common.min}
          </span>
          {product.calories && (
            <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
              <Flame className="h-4 w-4 text-brand" />
              {product.calories} kcal
            </span>
          )}
        </div>

        {product.optionGroups.map((group) => (
          <fieldset key={group.id} className="mt-7">
            <legend className="mb-3 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-ink-300">
                {group.name}
              </span>
              {group.required && <Badge tone="brand">{t.product.required}</Badge>}
              {group.maxSelect > 1 && (
                <span className="text-xs text-ink-200">
                  {interpolate(t.product.chooseUpTo, { n: group.maxSelect })}
                </span>
              )}
            </legend>

            <div className="flex flex-wrap gap-2.5">
              {group.options.map((option) => {
                const isSelected = (selected[group.id] ?? []).includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleOption(group, option.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'rounded-xl px-4 py-2.5 text-sm font-bold transition-colors',
                      isSelected
                        ? 'bg-brand text-white shadow-[0_8px_18px_-10px_rgba(255,118,34,1)]'
                        : 'bg-surface-field text-ink-600 hover:bg-surface-muted',
                    )}
                  >
                    {option.name}
                    {option.priceDeltaCents !== 0 && (
                      <span className={cn('ml-2 text-xs', isSelected ? 'text-white/85' : 'text-ink-300')}>
                        {option.priceDeltaCents > 0 ? '+' : ''}
                        {formatMoney(option.priceDeltaCents, currency, currencyDecimals)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        {product.ingredients.length > 0 && (
          <section className="mt-7">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-300">
              {t.product.ingredients}
            </h3>
            <div className="flex flex-wrap gap-2">
              {product.ingredients.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink-600"
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        )}

        {product.allergens.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-300">
              {t.product.allergens}
            </h3>
            <div className="flex flex-wrap gap-2">
              {product.allergens.map((item) => (
                <Badge key={item} tone="warning">
                  {item}
                </Badge>
              ))}
            </div>
          </section>
        )}

        <label className="mt-7 block">
          <span className="label">{t.product.itemNotes}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder={t.product.itemNotesPlaceholder}
            className="field resize-none"
          />
        </label>
      </div>

      <div className="bottom-bar">
        <div className="mb-4 flex items-center justify-between gap-4">
          <span className="font-display text-2xl font-bold text-ink">
            {formatMoney(total, currency, currencyDecimals)}
          </span>
          <QuantityStepper value={quantity} onChange={setQuantity} max={50} />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!product.available}
          className="btn-primary w-full py-4 text-[15px] uppercase tracking-wide"
        >
          {product.available ? t.product.addToCart : t.product.unavailable}
        </button>
      </div>

      <Sheet open={showViewer} onClose={() => setShowViewer(false)} title={product.name} size="lg">
        <DishViewer3D
          modelUrl={product.model3dUrl}
          iosModelUrl={product.modelArUrl}
          poster={product.image}
          alt={product.name}
          scale={product.modelScale}
          className="h-[60vh] w-full"
        />
        <p className="mt-4 text-center text-sm text-ink-300">{t.product.arHint}</p>
      </Sheet>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
        active ? 'bg-ink text-white' : 'text-ink-400 hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  );
}
