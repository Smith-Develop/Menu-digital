'use server';

import { cookies } from 'next/headers';
import { BROWSE_COOKIE } from '@/lib/store-context';

/**
 * Marca que el cliente está navegando por el escaparate.
 * La llama la portada; el QR de mesa hace lo contrario.
 */
export async function markMarketplaceVisit() {
  const store = await cookies();
  store.set(BROWSE_COOKIE, 'marketplace', {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
  });
}
