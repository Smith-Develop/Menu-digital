'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useDeliveryCart } from '@/lib/cart';
import { EmptyState, Spinner, ScreenHeader } from '@/components/ui/misc';
import { useT } from '@/i18n/provider';

export function CartRedirect() {
  const t = useT();
  const router = useRouter();
  const slug = useDeliveryCart((s) => s.restaurantSlug);
  const lines = useDeliveryCart((s) => s.lines);
  const [hydrated, setHydrated] = useState(false);

  // El carrito vive en localStorage: hasta que zustand rehidrata no sabemos
  // si hay algo, y redirigir antes mandaría al cliente a la pantalla vacía.
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (hydrated && slug && lines.length > 0) {
      router.replace(`/r/${slug}/cart`);
    }
  }, [hydrated, slug, lines.length, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (slug && lines.length > 0) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <ScreenHeader title={t.cart.title} backHref="/" />
      <EmptyState
        icon={<ShoppingBag className="h-7 w-7" />}
        title={t.cart.empty}
        description={t.cart.emptyHint}
        action={
          <Link href={slug ? `/r/${slug}` : '/'} className="btn-primary">
            {t.cart.startOrder}
          </Link>
        }
      />
    </>
  );
}
