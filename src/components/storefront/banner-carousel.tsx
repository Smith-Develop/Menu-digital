'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type BannerItem = {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  restaurant_name?: string;
  restaurant_slug?: string;
};

/**
 * Carrusel de banners promocionales.
 *
 * Los publica cada restaurante y en la portada aparecen mezclados —el orden
 * aleatorio lo decide la base de datos— filtrados por la ciudad del cliente.
 */
export function BannerCarousel({
  banners,
  autoPlayMs = 6000,
  className,
}: {
  banners: BannerItem[];
  autoPlayMs?: number;
  className?: string;
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (banners.length <= 1 || paused || autoPlayMs <= 0) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % banners.length), autoPlayMs);
    return () => clearInterval(id);
  }, [banners.length, paused, autoPlayMs]);

  useEffect(() => {
    const track = trackRef.current;
    const slide = track?.children[index] as HTMLElement | undefined;
    if (!track || !slide) return;
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  }, [index]);

  if (banners.length === 0) return null;

  return (
    <section
      className={cn('relative', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <ul
        ref={trackRef}
        className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5"
        onScroll={(e) => {
          // Mantiene los puntos sincronizados cuando se desliza con el dedo.
          const track = e.currentTarget;
          const children = Array.from(track.children) as HTMLElement[];
          const nearest = children.reduce(
            (best, child, i) =>
              Math.abs(child.offsetLeft - track.offsetLeft - track.scrollLeft) <
              Math.abs(children[best].offsetLeft - track.offsetLeft - track.scrollLeft)
                ? i
                : best,
            0,
          );
          if (nearest !== index) setIndex(nearest);
        }}
      >
        {banners.map((banner) => {
          const href = banner.link_url ?? (banner.restaurant_slug ? `/r/${banner.restaurant_slug}` : '#');
          return (
            <li
              key={banner.id}
              className="w-[86%] shrink-0 snap-start sm:w-[420px] lg:w-[520px]"
            >
              <Link
                href={href}
                className="group relative block aspect-[16/8] overflow-hidden rounded-2xl bg-surface-muted"
              >
                <Image
                  src={banner.image_url}
                  alt={banner.title ?? banner.restaurant_name ?? ''}
                  fill
                  sizes="(max-width: 640px) 86vw, 520px"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  {banner.restaurant_name && (
                    <span className="mb-1.5 inline-block rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink">
                      {banner.restaurant_name}
                    </span>
                  )}
                  {banner.title && (
                    <span className="block font-display text-lg font-bold leading-tight text-white sm:text-xl">
                      {banner.title}
                    </span>
                  )}
                  {banner.subtitle && (
                    <span className="mt-1 block line-clamp-2 text-sm text-white/80">
                      {banner.subtitle}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {banners.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {banners.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Ir al banner ${i + 1}`}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-5 bg-brand' : 'w-1.5 bg-surface-line hover:bg-ink-200',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
