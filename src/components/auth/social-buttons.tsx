'use client';

import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n/provider';

/**
 * Acceso con cuentas de terceros.
 *
 * Los proveedores se activan en el panel de Supabase; hasta entonces los
 * botones avisan de que no están disponibles en lugar de llevar a una pantalla
 * de error. Los iconos van dibujados a mano: cargarlos de una librería externa
 * obligaría a traer una dependencia entera por tres marcas.
 */
export function SocialButtons({
  google = false,
  facebook = false,
  apple = false,
}: {
  google?: boolean;
  facebook?: boolean;
  apple?: boolean;
}) {
  const t = useT();
  const toast = useToast();

  const proveedores = [
    { id: 'google', activo: google, fondo: '#FFFFFF', borde: true, icono: <GoogleIcon /> },
    { id: 'facebook', activo: facebook, fondo: '#1877F2', borde: false, icono: <FacebookIcon /> },
    { id: 'apple', activo: apple, fondo: '#000000', borde: false, icono: <AppleIcon /> },
  ];

  return (
    <div className="mt-7">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-surface-line" />
        <span className="text-xs text-ink-300">{t.auth.or}</span>
        <span className="h-px flex-1 bg-surface-line" />
      </div>

      <div className="mt-5 flex justify-center gap-4">
        {proveedores.map((proveedor) => (
          <button
            key={proveedor.id}
            type="button"
            onClick={() => toast(t.auth.socialSoon, 'info')}
            aria-label={proveedor.id}
            className={
              'flex h-12 w-12 items-center justify-center rounded-2xl shadow-chip transition-transform active:scale-95' +
              (proveedor.borde ? ' border border-surface-line' : '')
            }
            style={{ backgroundColor: proveedor.fondo }}
          >
            {proveedor.icono}
          </button>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-ink-300">{t.auth.socialHint}</p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6Z" />
      <path fill="#34A853" d="M12 23c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 20.5 7.6 23 12 23Z" />
      <path fill="#FBBC05" d="M5.6 13.7a6.6 6.6 0 0 1 0-4.2v-3H1.8a11 11 0 0 0 0 10l3.8-2.8Z" />
      <path fill="#EA4335" d="M12 5.4c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.9 15.1 1 12 1 7.6 1 3.7 3.5 1.8 7.2l3.8 2.9C6.5 7.4 9 5.4 12 5.4Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#FFFFFF" aria-hidden="true">
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#FFFFFF" aria-hidden="true">
      <path d="M16.4 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.2-2.6-.1 0-2.4-.9-2.4-3.6ZM14.2 5.6c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3Z" />
    </svg>
  );
}
