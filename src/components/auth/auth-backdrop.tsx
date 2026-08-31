'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';

/**
 * Portada de las pantallas de acceso.
 *
 * Vive en el marco común de esas páginas, así que es él quien decide qué imagen
 * toca según la ruta: cada pantalla tiene la suya y el superadministrador las
 * cambia desde el panel de marca.
 */
export function AuthBackdrop({
  login,
  register,
}: {
  login: string | null;
  register: string | null;
}) {
  const pathname = usePathname();
  const imagen = pathname.startsWith('/register') ? register : login;

  if (!imagen) return null;

  return (
    <>
      <Image src={imagen} alt="" fill priority sizes="100vw" className="object-cover" />
      {/* El logotipo y el selector de idioma van encima: sin este velo, una foto
          clara los dejaría ilegibles. */}
      <span className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/50 to-ink/80" />
    </>
  );
}
