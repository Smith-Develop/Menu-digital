import type { MetadataRoute } from 'next';
import { getBrand } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await getBrand();

  return {
    name: `${brand.appName} — ${brand.tagline}`,
    short_name: brand.appName,
    description: brand.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF7F5',
    theme_color: brand.primaryColor,
    categories: ['food', 'shopping', 'lifestyle'],
    lang: 'es',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: 'Buscar', short_name: 'Buscar', url: '/search' },
      { name: 'Mis pedidos', short_name: 'Pedidos', url: '/orders' },
    ],
  };
}
