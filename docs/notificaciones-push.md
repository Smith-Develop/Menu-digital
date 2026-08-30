# Notificaciones push

Avisan al móvil del cliente cuando su pedido cambia de estado y llevan los
comunicados que publica el superadmin.

## Puesta en marcha

Genera un par de claves VAPID (identifican a tu servidor ante los servicios de
push de Google y Apple) y ponlas en el entorno:

```bash
npx web-push generate-vapid-keys
```

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BC...      # viaja al navegador; es pública por diseño
VAPID_PRIVATE_KEY=DH...                 # sólo servidor, no la publiques
VAPID_SUBJECT=mailto:tu-correo@dominio  # contacto que exige el estándar
```

Sin estas variables la aplicación funciona igual: el botón de avisos no se
muestra y no se intenta ningún envío.

Los avisos **sólo funcionan sobre HTTPS** (o en `localhost`). En una compilación
de desarrollo tampoco: el service worker se desregistra a propósito durante
`next dev` para no servir páginas cacheadas, y sin él no hay push. Para probarlo
en local hace falta `next build` y `next start`.

## Cómo está montado

- `push_subscriptions` guarda cada dispositivo. `user_id` admite nulos porque
  los pedidos en mesa no exigen cuenta y su cliente también debe enterarse.
- `order_push_targets` ata una suscripción anónima a los pedidos concretos que
  hizo ese navegador. Es lo que permite avisar a quien pidió sin registrarse.
- El alta pasa por `POST /api/push/subscribe`, que escribe con la clave de
  servicio: el visitante es anónimo y no puede tener permiso de escritura sobre
  esas tablas, porque entonces cualquiera podría suscribirse a pedidos ajenos.
- `src/lib/push.ts` envía y, de paso, borra los dispositivos que responden 404 o
  410. Sin esa limpieza la tabla se llena de móviles muertos.

## Un detalle que conviene no romper

Todos los cambios de estado de un pedido deben pasar por la acción de servidor
`updateOrderStatus`. La pantalla de cocina y el panel de pedidos en directo
escribían antes la tabla `orders` directamente desde el navegador, y así el
aviso no salía nunca: no fallaba nada visible, simplemente el cliente no recibía
nada. Si en el futuro alguien vuelve a actualizar el estado desde el cliente,
los avisos dejarán de funcionar en silencio.

## Textos

Están en el bloque `push` de los dos diccionarios (`src/i18n/dictionaries`). El
estado `confirmed` no genera aviso a propósito: ocurre a la vez que el cliente
hace el pedido y está mirando la pantalla.
