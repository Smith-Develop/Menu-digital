/**
 * Service worker de Yumi.
 *
 * Deliberadamente conservador: la carta, los precios y el estado de los pedidos
 * cambian a cada momento, así que nada de eso se cachea. Solo guardamos el
 * armazón estático y una página de respaldo para cuando no hay conexión, que es
 * lo que exige un PWA instalable.
 */
const VERSION = 'yumi-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = '/offline';

const SHELL = [OFFLINE_URL, '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nada de API ni de autenticación: siempre a la red.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Navegación: red primero, y si falla la página de respaldo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Estáticos con hash en el nombre: caché primero, son inmutables.
  const isImmutable =
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:woff2?|ttf|otf|svg|png|jpg|jpeg|webp|avif|ico)$/i.test(url.pathname);

  if (!isImmutable) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

/**
 * Avisos push: cambios de estado del pedido y comunicados de la plataforma.
 *
 * El payload llega como JSON desde el servidor. Si viniera vacío o ilegible se
 * muestra un aviso genérico en vez de no mostrar nada: en algunos navegadores,
 * recibir un push y no mostrar notificación acaba revocando el permiso.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'Yumi';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña de la aplicación abierta, se reutiliza en vez de
      // abrir otra: el cliente que sigue su pedido no quiere diez pestañas.
      for (const client of clientList) {
        if (client.url.includes(new URL(target, self.location.origin).pathname) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clientList.length > 0 && 'navigate' in clientList[0]) {
        return clientList[0].navigate(target).then((client) => client && client.focus());
      }
      return self.clients.openWindow(target);
    }),
  );
});
