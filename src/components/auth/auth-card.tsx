import Image from 'next/image';
import type { ReactNode } from 'react';

/**
 * Marco de las pantallas de acceso.
 *
 * Una cabecera de color con el logotipo y, montada sobre ella, la tarjeta
 * blanca con el formulario. La cabecera usa la imagen que el superadministrador
 * haya subido para esa pantalla y, si no hay ninguna, un degradado con los
 * colores de la marca, de modo que el diseño se sostiene sin configurar nada.
 */
export function AuthCard({
  title,
  subtitle,
  imageUrl,
  logoUrl,
  appName,
  children,
  footer,
}: {
  title: string;
  subtitle?: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
  appName: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-surface-soft">
      <div className="relative h-[38dvh] min-h-[220px] w-full overflow-hidden">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill priority sizes="100vw" className="object-cover" />
        ) : (
          <span
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgb(var(--brand-rgb)) 0%, rgb(var(--accent-rgb)) 100%)',
            }}
          />
        )}

        <span className="absolute inset-x-0 top-0 flex justify-center pt-[9dvh]">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={appName}
              width={88}
              height={88}
              className="h-20 w-20 object-contain drop-shadow-lg"
            />
          ) : (
            <span className="font-display text-4xl font-bold text-white drop-shadow-lg">
              {appName}
            </span>
          )}
        </span>
      </div>

      {/* La tarjeta pisa la cabecera: el margen negativo es lo que crea el
          escalón redondeado sobre el que descansa el formulario. */}
      <main className="relative -mt-12 rounded-t-[32px] bg-white px-6 pb-12 pt-9 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-center font-display text-3xl font-bold text-ink">
            {title}
            <span className="text-brand">!</span>
          </h1>
          {subtitle && <p className="mt-2 text-center text-sm text-ink-300">{subtitle}</p>}

          {children}

          {footer}
        </div>
      </main>
    </div>
  );
}
