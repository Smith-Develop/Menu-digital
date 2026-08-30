import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { BROWSE_COOKIE } from '@/lib/store-context';

/**
 * Rutas que exigen sesión. El rol concreto lo comprueba cada layout.
 * /account y /orders quedan fuera a propósito: ambas tienen una versión
 * para visitantes que invita a iniciar sesión.
 */
const PROTECTED = ['/dashboard', '/admin', '/kitchen'];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  const needsAuth = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Con sesión iniciada, /login y /register no tienen sentido.
  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Visitar cualquier pantalla del escaparate deja marcado que el cliente está
  // navegando por Yumi; así, al entrar en una tienda, se le ofrece volver.
  // El QR de mesa hace lo contrario y fija el modo tienda.
  const MARKETPLACE_PATHS = ['/', '/search', '/orders', '/account', '/cart'];
  if (MARKETPLACE_PATHS.includes(pathname)) {
    response.cookies.set(BROWSE_COOKIE, 'marketplace', {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Todo excepto estáticos, imágenes y el webhook de Stripe (necesita el cuerpo intacto).
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|usdz|ico)$).*)',
  ],
};
