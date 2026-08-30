import { redirect } from 'next/navigation';

/**
 * La analítica vive ahora dentro del resumen: eran dos pantallas para mirar lo
 * mismo. La ruta se conserva porque puede estar guardada en marcadores.
 */
export default async function AnalyticsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(([, v]) => v) as [string, string][],
  );
  const query = params.toString();
  redirect(query ? `/dashboard?${query}` : '/dashboard');
}
