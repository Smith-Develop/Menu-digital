import { LocaleSwitcher } from '@/components/locale-switcher';

/**
 * Marco de las pantallas de acceso.
 *
 * Cada pantalla trae su propia composición —cabecera con la portada y tarjeta
 * blanca encima—, así que aquí sólo queda el selector de idioma, flotando sobre
 * la cabecera de color.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="absolute right-4 top-4 z-20 text-white drop-shadow">
        <LocaleSwitcher />
      </div>
      {children}
    </div>
  );
}
