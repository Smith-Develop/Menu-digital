'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Bike, Box, Clock, Heart, ShoppingBag } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Rating } from '@/components/ui/misc';
import { useT } from '@/i18n/provider';

/** Imagen con marco redondeado y color de fondo del diseño (Tint/2). */
export function DishImage({
  src,
  alt,
  className,
  sizes = '120px',
  priority,
}: {
  src: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn('relative overflow-hidden bg-surface-muted', className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover lg:img-fade"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-200">
          <ShoppingBag className="h-7 w-7" />
        </div>
      )}
    </div>
  );
}

/**
 * Tarjeta horizontal de plato (patrón "Food card" del Figma):
 * miniatura 120×136 a la izquierda, nombre, precio, valoración y acciones.
 */
export function FoodCard({
  href,
  name,
  priceCents,
  currency,
  currencyDecimals,
  image,
  rating,
  has3d,
  onAdd,
  onFavorite,
  isFavorite,
}: {
  href: string;
  name: string;
  priceCents: number;
  currency: string;
  currencyDecimals?: number;
  image: string | null;
  rating?: number;
  has3d?: boolean;
  onAdd?: () => void;
  onFavorite?: () => void;
  isFavorite?: boolean;
}) {
  return (
    <div className="flex w-[318px] shrink-0 gap-4 rounded-card bg-white pr-4">
      <Link href={href} className="shrink-0">
        <DishImage src={image} alt={name} className="h-[136px] w-[120px] rounded-lg" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-2">
        <div>
          <Link href={href}>
            <p className="truncate font-display text-lg font-bold text-ink-600">{name}</p>
          </Link>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-lg font-bold text-ink-600">
              {formatMoney(priceCents, currency, currencyDecimals)}
            </p>
            {typeof rating === 'number' && rating > 0 && <Rating value={rating} />}
          </div>
          {has3d && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-brand">
              <Box className="h-3 w-3" /> 3D
            </span>
          )}
        </div>

        <div className="flex items-end justify-end gap-3">
          {onFavorite && (
            <button
              type="button"
              onClick={onFavorite}
              aria-label="Favorito"
              className="rounded-3xl border border-surface-line p-3 transition-colors hover:border-brand"
            >
              <Heart className={cn('h-5 w-5', isFavorite ? 'fill-brand text-brand' : 'text-ink-600')} />
            </button>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              aria-label="Añadir al carrito"
              className="rounded-3xl bg-accent p-3 text-ink transition-transform active:scale-95"
            >
              <ShoppingBag className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tarjeta vertical con la imagen sobresaliendo por arriba
 * (patrón "Popular Fast Food" del Figma).
 *
 * El ancho y el hueco superior van juntos a propósito: la imagen sobresale la
 * mitad de su alto sobre la tarjeta, así que el `pt` del contenido tiene que
 * dejarle sitio. Con medidas más pequeñas la foto se comía el nombre del plato.
 */
export function PopularCard({
  href,
  name,
  subtitle,
  priceCents,
  currency,
  currencyDecimals,
  image,
}: {
  href: string;
  name: string;
  subtitle?: string | null;
  priceCents?: number;
  currency?: string;
  currencyDecimals?: number;
  image: string | null;
}) {
  return (
    <Link
      href={href}
      className="group block w-[186px] shrink-0 pt-[70px] sm:w-[210px] sm:pt-[80px]"
    >
      {/* Las animaciones se reservan al escritorio: en un móvil, con el dedo
          encima de la tarjeta, el rebote y el zoom se notan como un retardo. */}
      <div className="relative flex min-h-[132px] flex-col rounded-2xl bg-white px-4 pb-4 pt-[78px] shadow-chip sm:min-h-[148px] sm:pt-[88px] lg:transition-transform lg:group-active:scale-[0.98]">
        <div className="absolute -top-[70px] left-1/2 h-[140px] w-[140px] -translate-x-1/2 sm:-top-20 sm:h-40 sm:w-40">
          <DishImage
            src={image}
            alt={name}
            className="h-full w-full rounded-full ring-4 ring-white"
            sizes="(max-width: 640px) 140px, 160px"
          />
        </div>
        <p className="line-clamp-2 text-[15px] font-bold leading-snug text-ink-700">{name}</p>
        {subtitle && <p className="mt-1 truncate text-[13px] text-ink-500">{subtitle}</p>}
        {typeof priceCents === 'number' && (
          <p className="mt-auto pt-2 text-sm font-bold text-brand">
            {formatMoney(priceCents, currency, currencyDecimals)}
          </p>
        )}
      </div>
    </Link>
  );
}

/** Tarjeta de restaurante del marketplace ("Open Restaurants"). */
export function RestaurantCard({
  slug,
  name,
  description,
  cover,
  rating,
  ratingCount,
  deliveryFeeCents,
  prepMinutes,
  currency,
  currencyDecimals,
  isOpen,
  cuisineTags,
  sponsored = false,
}: {
  slug: string;
  name: string;
  description?: string | null;
  cover: string | null;
  rating: number;
  ratingCount?: number;
  deliveryFeeCents: number;
  prepMinutes: number;
  currency: string;
  currencyDecimals?: number;
  isOpen: boolean;
  cuisineTags?: string[];
  /** Este sitio está pagado, y se dice. */
  sponsored?: boolean;
}) {
  const t = useT();

  return (
    <Link href={`/r/${slug}`} className="group block lg:lift">
      <div className="relative h-[150px] w-full overflow-hidden rounded-2xl bg-surface-muted">
        {cover ? (
          <Image
            src={cover}
            alt={name}
            fill
            sizes="(max-width: 480px) 100vw, 440px"
            className="object-cover lg:img-fade lg:transition-transform lg:duration-500 lg:group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-200">
            <ShoppingBag className="h-8 w-8" />
          </div>
        )}
        {!isOpen && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/55">
            <span className="rounded-full bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink">
              {t.storefront.closed}
            </span>
          </div>
        )}
        {/* La etiqueta va encima de la foto y no debajo del nombre: quien mira
            la lista mira las fotos, y ahí es donde tiene que enterarse de que
            este sitio está comprado. */}
        {sponsored && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-500 shadow-chip">
            {t.sponsor.label}
          </span>
        )}
      </div>

      <div className="mt-3">
        <h3 className="font-display text-lg font-bold text-ink-700">{name}</h3>
        {description && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-300">{description}</p>
        )}
        {cuisineTags && cuisineTags.length > 0 && (
          <p className="mt-1 text-xs text-ink-300">{cuisineTags.slice(0, 3).join(' · ')}</p>
        )}

        <div className="mt-2.5 flex items-center gap-4">
          <Rating value={rating} count={ratingCount} />
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
            <Bike className="h-4 w-4 text-brand" />
            {deliveryFeeCents === 0
              ? t.common.free
              : formatMoney(deliveryFeeCents, currency, currencyDecimals)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-ink-400">
            <Clock className="h-4 w-4 text-brand" />
            {prepMinutes} {t.common.min}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Chip de categoría con imagen circular (patrón "All Categories"). */
export function CategoryChip({
  label,
  image,
  active,
  onClick,
  href,
}: {
  label: string;
  image?: string | null;
  active?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const content = (
    <span
      className={cn(
        'flex shrink-0 items-center gap-2.5 rounded-pill py-1.5 pl-1.5 pr-5 transition-colors',
        active ? 'bg-accent shadow-chip-active' : 'bg-white shadow-chip',
      )}
    >
      <span className="relative h-[46px] w-[46px] overflow-hidden rounded-full bg-surface-muted">
        {image ? (
          <Image src={image} alt="" fill sizes="46px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs font-bold text-ink-300">
            {label.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="text-[13px] font-bold capitalize text-ink-700">{label}</span>
    </span>
  );

  if (href) return <Link href={href}>{content}</Link>;

  return (
    <button type="button" onClick={onClick}>
      {content}
    </button>
  );
}
