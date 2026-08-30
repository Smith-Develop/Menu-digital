'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { OnboardingSlide } from '@/lib/auth-screens';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

const SEEN_KEY = 'yumi_onboarding_seen';

/**
 * Bienvenida de la aplicación: portada de marca y diapositivas.
 *
 * Solo se enseña la primera vez —queda anotado en localStorage—, porque a
 * partir de ahí es un obstáculo entre el cliente y la comida.
 */
export function Onboarding({
  slides,
  brand,
  showSplash,
}: {
  slides: OnboardingSlide[];
  brand: { appName: string; tagline: string; logoUrl: string | null; primaryColor: string };
  showSplash: boolean;
}) {
  const t = useT();
  const router = useRouter();

  const [phase, setPhase] = useState<'splash' | 'slides'>(showSplash ? 'splash' : 'slides');
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) {
        router.replace('/login');
        return;
      }
    } catch {
      /* almacenamiento bloqueado: se muestra igualmente */
    }
    setChecked(true);
  }, [router]);

  useEffect(() => {
    if (phase !== 'splash' || !checked) return;
    const timer = setTimeout(() => setPhase('slides'), 1600);
    return () => clearTimeout(timer);
  }, [phase, checked]);

  function finish() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* sin persistencia volverá a aparecer, no es grave */
    }
    router.replace('/login');
  }

  function next() {
    if (index < slides.length - 1) setIndex(index + 1);
    else finish();
  }

  if (!checked) return <div className="min-h-dvh bg-white" />;

  if (phase === 'splash') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center px-8"
        style={{ backgroundColor: brand.primaryColor }}
      >
        <div className="animate-scale-in text-center">
          {brand.logoUrl ? (
            <Image
              src={brand.logoUrl}
              alt={brand.appName}
              width={96}
              height={96}
              className="mx-auto mb-6 rounded-3xl"
            />
          ) : (
            <span className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-white/20 font-display text-4xl font-bold text-white backdrop-blur">
              {brand.appName.charAt(0)}
            </span>
          )}
          <h1 className="font-display text-4xl font-bold tracking-tight text-white">
            {brand.appName}
          </h1>
          <p className="mt-2 text-sm text-white/80">{brand.tagline}</p>
        </div>
      </div>
    );
  }

  const slide = slides[index];

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <div className="flex justify-end px-6 pt-6">
        <button
          type="button"
          onClick={finish}
          className="text-sm font-semibold text-ink-300 transition-colors hover:text-ink"
        >
          {t.onboarding.skip}
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div key={slide.id} className="w-full max-w-sm animate-fade-up">
          <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-[40px] bg-surface-muted">
            {slide.imageUrl && (
              <Image
                src={slide.imageUrl}
                alt=""
                fill
                priority
                sizes="280px"
                className="img-fade object-cover"
              />
            )}
          </div>

          <h2 className="mt-10 font-display text-[28px] font-bold leading-tight text-ink">
            {slide.title}
          </h2>
          {slide.subtitle && (
            <p className="mt-3 text-[15px] leading-relaxed text-ink-300">{slide.subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-8 pb-10">
        <div className="flex gap-2">
          {slides.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`${t.onboarding.slide} ${i + 1}`}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                i === index ? 'w-6 bg-brand' : 'w-2 bg-surface-line hover:bg-ink-200',
              )}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={next}
          aria-label={index < slides.length - 1 ? t.onboarding.next : t.onboarding.start}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white shadow-card transition-transform active:scale-95"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
