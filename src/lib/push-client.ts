/**
 * Alta del dispositivo en los avisos push, desde el navegador.
 *
 * Vive aparte del componente que lo ofrecía porque ahora lo usan varios sitios:
 * la bienvenida, la ficha de un pedido y el panel del restaurante, donde al
 * camarero le tienen que llegar las llamadas de sus mesas.
 */
export type PushOutcome =
  | 'ok'
  | 'sin-configurar'
  | 'sin-soporte'
  | 'sitio-inseguro'
  | 'denegado'
  | 'fallo';

/**
 * Da de alta el dispositivo y explica por qué no pudo, si no pudo.
 *
 * Devolver sólo un booleano dejaba al usuario ante un botón que no hacía nada
 * visible, y las causas son bien distintas: faltan las claves del servidor, el
 * navegador ya tiene el permiso denegado, o la página no va por HTTPS —fuera de
 * `localhost` los navegadores ni siquiera preguntan—.
 */
export async function subscribeToPush(opciones: {
  citySlug?: string | null;
  orderId?: string;
} = {}): Promise<PushOutcome> {
  if (typeof window === 'undefined') return 'fallo';

  if (!window.isSecureContext) return 'sitio-inseguro';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'sin-soporte';
  }
  if (Notification.permission === 'denied') return 'denegado';

  const clave = await clavePublica();
  if (!clave) return 'sin-configurar';

  try {
    if (Notification.permission !== 'granted') {
      const respuesta = await Notification.requestPermission();
      if (respuesta !== 'granted') return 'denegado';
    }

    const registro = await registroActivo();
    if (!registro) return 'fallo';

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

    return respuesta.ok ? 'ok' : 'fallo';
  } catch {
    return 'fallo';
  }
}

let claveEnMemoria: string | null | undefined;

/**
 * Clave pública del servidor, preguntada una sola vez por sesión.
 *
 * Se prefiere la del entorno si el build la incrustó, y si no se pide al
 * servidor: así los avisos funcionan aunque las claves se hayan añadido al
 * despliegue después de compilar.
 */
async function clavePublica(): Promise<string | null> {
  const incrustada = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (incrustada) return incrustada;

  if (claveEnMemoria !== undefined) return claveEnMemoria;

  try {
    const respuesta = await fetch('/api/push/key');
    const datos = (await respuesta.json()) as { key: string | null };
    claveEnMemoria = datos.key ?? null;
  } catch {
    claveEnMemoria = null;
  }

  return claveEnMemoria;
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
