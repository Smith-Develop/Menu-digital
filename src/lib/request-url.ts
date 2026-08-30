import 'server-only';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

/**
 * Origen público de la aplicación.
 *
 * Detrás de un proxy inverso (Coolify, Vercel, Nginx) `request.url` es la
 * dirección interna — normalmente http://localhost:3000 — así que redirigir con
 * ella manda al usuario a su propia máquina. El origen real viaja en las
 * cabeceras `x-forwarded-*`, y solo si no están recurrimos a la variable de
 * entorno o a la URL de la petición.
 */
export function originFromRequest(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  if (forwardedHost) {
    const proto = forwardedProto?.split(',')[0].trim() || 'https';
    return `${proto}://${forwardedHost.split(',')[0].trim()}`;
  }

  const host = request.headers.get('host');
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return `${forwardedProto || 'https'}://${host}`;
  }

  return env.siteUrl.replace(/\/$/, '') || request.nextUrl.origin;
}

/** Misma lógica desde un Server Component o Server Action. */
export async function getPublicOrigin(): Promise<string> {
  const headerList = await headers();

  const forwardedHost = headerList.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = headerList.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
    return `${proto}://${forwardedHost.split(',')[0].trim()}`;
  }

  const host = headerList.get('host');
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    const proto = headerList.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
    return `${proto}://${host}`;
  }

  return env.siteUrl.replace(/\/$/, '');
}
