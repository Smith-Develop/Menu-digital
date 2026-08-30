import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Menu Digital',
    short_name: 'Menu',
    description: 'Carta digital, pedidos en mesa y a domicilio para restaurantes',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF7F5',
    theme_color: '#FF7622',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
