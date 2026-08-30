# Yumi — Tu comida favorita, en minutos.

Plataforma multi-restaurante de carta digital: QR por mesa, pedidos en mesa y a
domicilio, reparto propio de cada restaurante, vista 3D y realidad aumentada de
los platos, pantalla de cocina, panel de gestión por restaurante y
superadministración con planes de suscripción cobrados por Stripe.

Cada restaurante tiene su propia URL (`/r/su-slug`) que muestra **solo su carta**,
mientras que la portada funciona como escaparate de los locales **de la ciudad
del cliente**. Es instalable como PWA.

---

## Cómo funciona

| Quién | Dónde entra | Qué hace |
|---|---|---|
| Cliente en la calle | `/` | Busca restaurantes y platos de su ciudad |
| Cliente de un local | `/r/<slug>` | Ve solo la carta de ese restaurante y pide a domicilio o para recoger |
| Cliente en la mesa | `/m/<código>` (QR) | Pide desde la mesa, llama al camarero y sigue su comanda |
| Cualquiera con un pedido | `/order/<token>` | Sigue el estado sin necesidad de cuenta |
| Repartidor | `/courier` | Acepta repartos de todos los restaurantes para los que trabaja |
| Restaurante | `/dashboard` | Pedidos en directo, carta, mesas y QR, banners, cupones, equipo, repartidores, ajustes, suscripción |
| Cocina | `/kitchen` | Tablero de comandas con aviso sonoro y contador de minutos |
| Superadministrador | `/admin` | Restaurantes, planes, cupones de plataforma, marca y notificaciones por ciudad |

### Dos cestas, no una

Pedir sentado y pedir a domicilio son carritos separados, con su propia clave en
`localStorage`. Un cliente puede tener la comanda abierta en el local y, a la
vez, un pedido a casa a medio montar sin que se mezclen. Desde la mesa el único
tipo posible es "en mesa"; domicilio y recogida solo aparecen en el carrito de
fuera del local.

La comanda de mesa **no desaparece al servirse**: sigue en la cuenta del
comensal hasta que el restaurante la marca como cobrada, que es cuando la mesa
queda libre.

### Tienda o escaparate

Quien llega a `/r/<slug>` navegando por Yumi puede volver al escaparate y buscar
otros locales. Quien abre el enlace directamente —lo compartieron por WhatsApp o
escaneó un QR— se queda dentro de esa tienda: para él la aplicación *es* ese
restaurante. Se decide con el `Referer` y se recuerda en cookie mientras dure la
visita (`lib/store-context.ts`).

### Cupones

Un restaurante crea cupones para su local; el superadministrador, cupones de
plataforma válidos en cualquiera. Si coinciden en código, gana el del
restaurante. Pueden ser porcentaje, importe fijo o envío gratis, y acotarse a
platos o categorías concretas.

El descuento **lo calcula siempre el servidor** (`validate_coupon` y
`place_order` comparten `compute_coupon_discount`), así que el importe que ve el
cliente y el que se cobra salen del mismo sitio. Canjear desde la mesa exige
iniciar sesión: es lo único que impide que el mismo comensal gaste el cupón una
y otra vez desde el mismo QR.

### El QR de mesa

`/m/<código>` guarda el código en una cookie del restaurante y redirige a la
carta. A partir de ahí el cliente navega con normalidad y la aplicación sabe en
todo momento desde qué mesa está pidiendo, sin arrastrar parámetros en la URL.

### Vista 3D y realidad aumentada

Cada plato admite un `.glb` (3D + AR en Android vía Scene Viewer) y,
opcionalmente, un `.usdz` (AR en iOS vía Quick Look). El visor usa
`<model-viewer>`, cargado solo en el navegador porque es un *web component*.

### La ciudad manda

El cliente elige su ciudad (o la detecta con el navegador) y a partir de ahí solo
ve restaurantes, categorías, platos destacados y banners de esa ciudad. La
elección vive en una cookie propia y no en la sesión, porque la mayoría pide sin
cuenta y la portada necesita el dato en el primer render.

La detección por GPS no usa ningún geocodificador externo: compara las
coordenadas del navegador con las de los propios restaurantes mediante la
fórmula del haversine (`nearest_city()`) y se queda con la ciudad más cercana.

### Reparto propio

Un repartidor se da de alta él mismo en `/courier` y cada restaurante lo añade a
su equipo por correo. Como la relación es de muchos a muchos, el mismo
repartidor trabaja para varios locales a la vez y ve la oferta de todos ellos en
una sola lista, sin depender de un único pagador.

Cuando dos repartidores van a por el mismo pedido gana el primero: `courier_take_order()`
hace un `UPDATE` condicionado a que siga sin asignar, así que el segundo recibe
`ORDER_NOT_AVAILABLE` en lugar de robar el reparto.

### Marca configurable

El superadministrador cambia nombre, lema, descripción, logotipo y colores desde
`/admin/branding`, y cada restaurante puede fijar los suyos para su tienda. Los
colores viajan como variables CSS (`--brand-rgb` en canales sueltos, para que
`bg-brand/20` siga funcionando) y las escalas se derivan con `color-mix`, así que
cambiar un color repinta toda la interfaz sin recompilar.

### Notificaciones por ciudad

Avisos emergentes que el superadministrador dirige a todas las ciudades o solo a
las que elija. Los ya vistos se recuerdan en `localStorage`: son mensajes de
campaña, no información crítica, y no merecen una tabla ni una cuenta.

### Impresión de tickets

El ticket se maqueta en milímetros para impresora térmica (58 mm, 80 mm o A4) y
se puede lanzar al aceptar el pedido. **Los navegadores no permiten elegir
impresora ni saltarse el diálogo** —es una restricción de seguridad—, así que
para imprimir en silencio hay que abrir el panel en el equipo de caja con Chrome
en modo quiosco:

```bash
chrome --kiosk-printing --app=https://tu-dominio/dashboard/orders
```

Con la impresora de tickets como predeterminada del sistema, a partir de ahí las
comandas salen directas.

### Altas del equipo por invitación

El restaurante no crea cuentas ajenas: genera un enlace `/join/<token>` que la
persona abre para registrarse con su propia contraseña. Así no hace falta la
clave de administración de Supabase en el servidor y nadie maneja credenciales
de otro. La invitación va atada a un correo concreto y se consume al usarse.

### Suscripciones

Un restaurante deja de servir su carta en cuanto su suscripción caduca: la
comprobación vive en la función `restaurant_is_live()` de Postgres y la aplican
las propias políticas RLS, así que no depende de que el código de la aplicación
se acuerde de mirarlo.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # y rellena las claves
npm run dev
```

### Variables de entorno

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de la instancia de Supabase | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Salta RLS. Solo servidor: la usa el webhook de Stripe | Solo para Stripe |
| `NEXT_PUBLIC_SITE_URL` | Base de los QR y del enlace para compartir | Sí en producción |
| `STRIPE_SECRET_KEY` | Cobro de suscripciones | Opcional |
| `STRIPE_WEBHOOK_SECRET` | Verificación de la firma del webhook | Con Stripe |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Cliente de Stripe | Con Stripe |

Sin claves de Stripe la aplicación funciona entera; solo el botón de renovar
avisa de que los pagos no están configurados, y el superadministrador puede
asignar y prorrogar planes a mano desde `/admin/restaurants`.

---

## Base de datos

Las migraciones de `supabase/migrations/` se aplican **en orden**:

| Archivo | Contenido |
|---|---|
| `0001_schema.sql` | Tipos, 17 tablas, índices y triggers |
| `0002_rls.sql` | Funciones auxiliares, políticas RLS y publicación Realtime |
| `0003_functions.sql` | `place_order`, `get_order_by_token`, `call_waiter`, `restaurant_stats` |
| `0004_storage.sql` | Buckets de imágenes y modelos 3D con sus políticas |
| `0005_seed_plans.sql` | Los cinco planes de partida |
| `0006_yumi.sql` | Ciudades, banners, repartidores, marca y notificaciones |
| `0007_yumi_rls.sql` | RLS de las tablas nuevas y acceso del repartidor a pedidos |
| `0008_yumi_functions.sql` | `list_cities`, `nearest_city`, `home_banners`, flujo de reparto |
| `0009_storage_app.sql` | El superadministrador sube el logotipo de la aplicación |
| `0010_coupons.sql` | Cupones, invitaciones de equipo y ajustes de impresión |
| `0011_coupon_functions.sql` | Cálculo y validación de descuentos |
| `0012_order_coupon.sql` | `place_order` con cupón, cuenta de mesa e invitaciones |
| `0013_coupons_rls.sql` | RLS de cupones e invitaciones |
| `0014_profiles_team_read.sql` | El restaurante ve los datos de su propio equipo |

`supabase/seed-demo.sql` crea un restaurante de ejemplo con carta, mesas y
cuentas. Las contraseñas llegan por entorno para que el archivo pueda vivir en
el repositorio:

```bash
DEMO_ADMIN_PW=... DEMO_OWNER_PW=... DEMO_KITCHEN_PW=... DEMO_COURIER_PW=... \
SUPABASE_STUDIO_AUTH=usuario:contraseña \
python3 scripts/seed-demo.py
```

`supabase/seed-cities.sql` añade restaurantes en Madrid, Barcelona y Valencia con
sus banners, útil para ver el filtrado por ciudad funcionando.

Tras cambiar una migración, regenera los tipos de TypeScript:

```bash
SUPABASE_STUDIO_AUTH=usuario:contraseña npm run db:types
```

### Modelo de seguridad

RLS está activo y **forzado** en las 17 tablas:

- **Anónimo** solo lee la carta de restaurantes activos y con suscripción viva.
- **Los pedidos no se escriben desde el navegador.** El cliente llama a
  `place_order()`, una función `SECURITY DEFINER` que recalcula todos los
  precios desde la base de datos: los importes que manda el navegador se ignoran.
- **El seguimiento sin cuenta** usa `get_order_by_token()`, que devuelve
  únicamente los campos que necesita la pantalla de estado.
- **El equipo** solo ve y toca su propio restaurante, con permisos por rol
  (propietario, administrador, encargado, camarero, cocina, caja).

---

## Estructura

```
src/
├── app/
│   ├── (storefront)/       portada, búsqueda, carrito, mis pedidos, perfil
│   ├── r/[slug]/           carta del restaurante, plato, carrito, checkout, mesa
│   ├── m/[code]/           entrada de los QR de mesa
│   ├── order/[token]/      seguimiento público del pedido
│   ├── courier/            panel del repartidor
│   ├── dashboard/          panel del restaurante
│   ├── kitchen/            pantalla de cocina
│   ├── admin/              superadministración
│   ├── offline/            página de respaldo del service worker
│   └── api/                QR, checkout y webhook de Stripe
├── components/             ui, storefront, product, dashboard, kitchen, admin, courier, pwa
├── i18n/                   diccionarios es/en y proveedor
├── lib/                    supabase, auth, dinero, carrito, utilidades
└── types/                  tipos generados de la base de datos
```

---

## Decisiones que conviene conocer

**Los importes se guardan como enteros en la unidad menor de la divisa.** 12,50 €
son 1250. Cuántos decimales tiene esa unidad depende de la divisa (EUR 2, COP 0,
KWD 3), por eso cada restaurante guarda `currency` y `currency_decimals`. El
formato siempre usa coma decimal, sea cual sea la divisa.

**El seguimiento del pedido va por sondeo, no por Realtime.** El cliente es
anónimo y Realtime necesita una sesión que satisfaga RLS. El panel y la cocina,
que sí tienen sesión, usan Realtime.

**El historial de estados lo escriben dos triggers.** Las marcas de tiempo se
sellan en `BEFORE` (para que viajen en la misma fila) y el evento se inserta en
`AFTER`, cuando el pedido ya existe y la clave foránea se puede satisfacer.

**Detrás de un proxy, `request.url` es la dirección interna.** Redirigir con ella
mandaba los QR de mesa a `localhost`. El origen público se saca de las cabeceras
`x-forwarded-*` en `lib/request-url.ts`, y solo si faltan se recurre a
`NEXT_PUBLIC_SITE_URL`.

**El impuesto se calcula sobre la base ya descontada**, y el descuento nunca
puede superar el subtotal. Los importes se recalculan en `place_order` a partir
de la base de datos: lo que manda el navegador se ignora.

**El service worker es deliberadamente conservador.** La carta, los precios y el
estado de los pedidos cambian a cada momento, así que no se cachea nada de eso:
solo el armazón estático y una página de respaldo sin conexión.

**Los tipos de la base de datos se generan contra el esquema real** con
`scripts/gen-db-types.py`, que consulta el endpoint pg-meta del Studio. No hace
falta la CLI de Supabase ni abrir el puerto 5432.

---

## Correo

Los correos salen de **dos sitios distintos**:

| Qué correo | Quién lo manda | Dónde se configura |
|---|---|---|
| Confirmación de registro y recuperación | GoTrue (Supabase Auth) | Variables del despliegue de Supabase |
| Invitación al equipo | La aplicación | `SMTP_*` en `.env.local` |

El SMTP de la aplicación ya está puesto. **Falta el de GoTrue**: sin él nadie
puede registrarse, porque la instancia exige confirmar el correo
(`mailer_autoconfirm = false`) y ese correo no llega a enviarse. Las variables
exactas están en [`docs/correo.md`](docs/correo.md).

## Comandos

```bash
npm run dev        # desarrollo
npm run build      # compilación de producción
npm run start      # servidor de producción
npm run lint       # ESLint
npm run typecheck  # TypeScript sin emitir
npm run db:types   # regenerar src/types/database.ts
```

## Pila

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 3 ·
Supabase (Postgres, Auth, Storage, Realtime) · Stripe · `<model-viewer>` ·
Zustand · PWA con service worker propio ·
Diseño basado en el Figma [menu-app](https://www.figma.com/design/TVU2oHj08Qkm5WqEI5JRK7/menu-app)
