import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

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

  return response;
}

export const config = {
  matcher: [
    // Todo excepto estáticos, imágenes y el webhook de Stripe (necesita el cuerpo intacto).
    '/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|usdz|ico)$).*)',
  ],
};
