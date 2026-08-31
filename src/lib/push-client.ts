/**
 * Alta del dispositivo en los avisos push, desde el navegador.
 *
 * Vive aparte del componente que lo ofrecía porque ahora lo usan varios sitios:
 * la bienvenida, la ficha de un pedido y el panel del restaurante, donde al
 * camarero le tienen que llegar las llamadas de sus mesas.
 */
export async function subscribeToPush(opciones: {
  citySlug?: string | null;
  orderId?: string;
} = {}): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const clave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!clave) return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'denied') return false;

  try {
    if (Notification.permission !== 'granted') {
      const respuesta = await Notification.requestPermission();
      if (respuesta !== 'granted') return false;
    }

    const registro = await registroActivo();
    if (!registro) return false;

    const existente = await registro.pushManager.getSubscription();
    const suscripcion =
      existente ??
      (await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveBinaria(clave) as BufferSource,
      }));

    const datos = suscripcion.toJSON() as { endpoint?: string; keys?: Record<string, string> };

    const respuesta = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: datos.endpoint,
        keys: datos.keys,
        citySlug: opciones.citySlug ?? null,
        locale: document.documentElement.lang || 'es',
        orderId: opciones.orderId,
      }),
    });

    return respuesta.ok;
  } catch {
    return false;
  }
}

/**
 * El service worker listo para suscribir, registrándolo si hiciera falta.
 * `navigator.serviceWorker.ready` no resuelve nunca cuando no hay ninguno, así
 * que esperar por él a secas dejaría la promesa colgada para siempre.
 */
async function registroActivo(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existente = await navigator.serviceWorker.getRegistration('/');
    if (!existente) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
}

/** La clave VAPID, del texto que viaja al navegador al binario que espera. */
function claveBinaria(base64: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalizada = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = window.atob(normalizada);
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)));
}
