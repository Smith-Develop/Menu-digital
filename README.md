# Yumi — Tu comida favorita, en minutos.

Plataforma multi-comercio con tres caras a la vez:

- **Un escaparate** donde el cliente encuentra los locales de su ciudad, pide a
  domicilio, para recoger o desde la mesa con un QR, y sigue su pedido sin
  necesidad de cuenta.
- **Un TPV completo** para cada comercio: pedidos en directo, sala, cocina,
  caja con turno y arqueo, existencias, documento fiscal numerado, reparto
  propio y cobro en línea.
- **Un negocio de plataforma**: cuotas de suscripción, comisión sobre lo
  vendido, sitios destacados en la portada y facturación a los comercios.

Sirve a **restaurantes y a supermercados**. Lo que cambia entre uno y otro no es
el código sino los módulos que se encienden: un supermercado no tiene cocina ni
mesas, pero sí pasillos, franjas de entrega y códigos de barras.

Cada comercio tiene su propia URL (`/r/su-slug`) que muestra **solo su carta**.
Es instalable como PWA.

---

## Quién entra y dónde

| Quién | Dónde | Qué hace |
|---|---|---|
| Cliente en la calle | `/` | Busca comercios y productos de su ciudad |
| Cliente de un local | `/r/<slug>` | Ve solo ese catálogo; pide a domicilio o para recoger |
| Cliente en la mesa | `/m/<código>` (QR) | Pide desde la mesa, llama al camarero, sigue su comanda |
| Quien acaba de pagar | `/pago/<intento>` | Pantalla de vuelta de la pasarela mientras llega el aviso |
| Cualquiera con un pedido | `/order/<token>` | Sigue el estado sin cuenta |
| Repartidor | `/courier` | Acepta repartos de todos los comercios para los que trabaja |
| Comercio | `/dashboard` | El panel entero (abajo) |
| Cocina | `/kitchen` | Comandas con aviso sonoro y contador de minutos |
| Superadministrador | `/admin` | La plataforma entera (abajo) |

**Panel del comercio** (`/dashboard`): resumen con métricas · pedidos y sala ·
preparación por pasillos · TPV · caja · carta · mesas y QR · franjas de entrega ·
banners · cupones · equipo · repartidores · **formas de cobro** · destacados ·
suscripción · ajustes.

**Panel de la plataforma** (`/admin`): restaurantes · planes · ingresos ·
**pasarelas de pago** · **países y ciudades** · catálogo de categorías ·
repartidores · cupones · banners de portada · marca · notificaciones · cuenta.

Cada sección aparece según **el rol** de quien mira (`lib/auth-permissions.ts`)
y según **el tipo de negocio** (`lib/business-modules.ts`). El menú enseña
exactamente lo que esa persona puede abrir: nunca ofrece puertas cerradas.

---

## Cómo funciona

### Pedir exige cuenta

Antes de confirmar, el cliente se registra o inicia sesión desde el propio
checkout. Sin cuenta pierde el seguimiento en cuanto cierra la pestaña, porque
el enlace del pedido vive solo en esa navegación. Si ya tiene ciudad y dirección
guardadas, se usan tal cual: no se le vuelve a preguntar lo que ya dijo.

### Dos cestas, no una

Pedir sentado y pedir a domicilio son carritos separados, con su propia clave en
`localStorage`. Desde la mesa el único tipo posible es "en mesa"; domicilio y
recogida solo aparecen en el carrito de fuera del local.

La comanda de mesa **no desaparece al servirse**: sigue en la cuenta del
comensal hasta que el comercio la da por cobrada, que es cuando la mesa queda
libre. El QR deja una cookie atada al **turno** de esa mesa, así que quien comió
el martes no sigue "sentado en la mesa 7" el jueves desde su casa.

### Tienda o escaparate

Quien llega a `/r/<slug>` navegando por Yumi puede volver al escaparate. Quien
abre el enlace directamente —lo compartieron por WhatsApp o escaneó un QR— se
queda dentro de esa tienda: para él la aplicación *es* ese comercio. Se decide
con el `Referer` y se recuerda en cookie mientras dure la visita
(`lib/store-context.ts`).

### La ciudad manda

El cliente elige su ciudad (o la detecta con el navegador) y a partir de ahí solo
ve comercios, categorías, productos destacados y banners de esa ciudad. La
elección vive en una cookie propia y no en la sesión, porque la mayoría mira sin
cuenta y la portada necesita el dato en el primer render.

La detección por GPS no usa ningún geocodificador externo: compara las
coordenadas del navegador con las de los propios comercios mediante la fórmula
del haversine (`nearest_city()`).

### Cupones

Un comercio crea cupones para su local; el superadministrador, cupones de
plataforma válidos en cualquiera. Si coinciden en código, gana el del comercio.
Pueden ser porcentaje, importe fijo o envío gratis, y acotarse a productos o
categorías concretas. El cliente los guarda en su cuenta al canjearlos.

El descuento **lo calcula siempre el servidor** (`validate_coupon` y
`place_order` comparten `compute_coupon_discount`), así que lo que ve el cliente
y lo que se cobra salen del mismo sitio.

### Reparto propio

Un repartidor se da de alta él mismo en `/courier` y cada comercio lo añade a su
equipo por correo. La relación es de muchos a muchos: el mismo repartidor
trabaja para varios locales y ve la oferta de todos en una sola lista.

Cuando dos van a por el mismo pedido gana el primero: `courier_take_order()`
hace un `UPDATE` condicionado a que siga sin asignar, así que el segundo recibe
`ORDER_NOT_AVAILABLE` en lugar de robar el reparto.

El flujo llega hasta el final: recogida, entrega y **liquidación del efectivo**.
Sin lo último, un pedido cobrado en la puerta desaparecía del panel antes de que
ese dinero llegara a la caja.

### Vista 3D y realidad aumentada

Cada producto admite un `.glb` (3D + AR en Android vía Scene Viewer) y,
opcionalmente, un `.usdz` (AR en iOS vía Quick Look). El visor usa
`<model-viewer>`, cargado solo en el navegador porque es un *web component*.

### Marca configurable

El superadministrador cambia nombre, lema, descripción, logotipo y colores desde
`/admin/branding`, y cada comercio puede fijar los suyos para su tienda. Los
colores viajan como variables CSS (`--brand-rgb` en canales sueltos, para que
`bg-brand/20` siga funcionando) y las escalas se derivan con `color-mix`: cambiar
un color repinta toda la interfaz sin recompilar.

### Altas del equipo, de dos maneras

- **Invitación por enlace** (`/join/<token>`): la persona abre el enlace y elige
  su propia contraseña. El comercio nunca ve credenciales ajenas. El enlace va
  atado a un correo concreto, caduca a los 14 días y se consume al usarse.
- **Alta directa**: el comercio crea la cuenta y entrega la contraseña en mano.
  Usa un cliente sin sesión, de modo que dar de alta a otro no toca la sesión de
  quien está en el panel.

### Impresión de tickets

El ticket se maqueta en milímetros para impresora térmica (58 mm, 80 mm o A4).
**Los navegadores no permiten elegir impresora ni saltarse el diálogo**, así que
para imprimir en silencio hay que abrir el panel en el equipo de caja con Chrome
en modo quiosco:

```bash
chrome --kiosk-printing --app=https://tu-dominio/dashboard/orders
```

---

## Los dos verticales

`restaurants.business_type` dice qué clase de negocio es, y la tabla
`business_modules` dice qué módulos enciende cada tipo. Es una tabla y no una
condición dentro del código para que dar de alta un vertical nuevo no obligue a
tocar nada.

| Módulo | Restaurante | Supermercado |
|---|---|---|
| Pedidos, TPV, caja, carta, cupones, banners, repartidores, equipo, ajustes | sí | sí |
| Cocina, mesas, sala | sí | **no** |
| Preparación por pasillos, franjas de entrega, códigos de barras | **no** | sí |

Lo que no aplica **se apaga de verdad**, no solo se esconde: un disparador fuerza
`dinein_enabled = false` en los supermercados, y entonces `place_order` rechaza
el pedido en mesa sin que haya que tocarlo. La regla vive en la base porque el
formulario no es el único camino —quedan la API, el panel de la plataforma y
cualquier importación.

Lo que un supermercado necesita y un restaurante no:

- **Producto de estantería**: unidad de venta, marca, formato, contenido neto,
  venta a peso, código de barras y precio por kilo o por litro.
- **Catálogo en árbol**: pasillo → familia. Dos niveles bastan; un tercero
  convierte la navegación en un laberinto.
- **Alta masiva**: `import_products()` mete miles de referencias de golpe.
  Decide **antes** de escribir, en dos fases, porque un `return` de plpgsql no
  deshace lo ya escrito y la primera versión dejaba catálogos a medias.
- **Preparación por pasillos**: la lista ordenada por recorrido, con recogido
  parcial y sustituciones —y una sustitución nunca cuesta más que el original.
- **Franjas de entrega**: se elige la hora al pedir, con control de aforo por
  franja hecho con `for update` para que dos clientes no cojan el último hueco.

---

## El dinero

Es la parte más trabajada, y es lo que separa un panel de pedidos de un TPV.

**Los cobros son apuntes, no un interruptor.** Antes el pedido decía "pagado" o
"pendiente", y con eso no se puede dividir una cuenta, ni cobrar mitad en
efectivo y mitad con tarjeta, ni devolver dinero: todo eso son *varios*
movimientos sobre la misma venta. El libro (`order_payments`) es inmutable: se
corrige con un apunte contrario, nunca borrando.

**La caja tiene turno.** Apertura con fondo, movimientos, cierre con recuento y
**descuadre**. Sin comparar lo cobrado con lo que hay en el cajón no hay forma de
saber si falta dinero, ni cuánto, ni de qué turno. El efectivo que cobra un
repartidor no entra en la caja hasta que lo liquida: es dinero cobrado que
todavía no está en el cajón.

**El ticket es un documento fiscal.** Serie y numeración correlativa **por
comercio**, identificación fiscal del emisor y desglose por tipo impositivo. El
número de pedido no vale: es un contador global de la plataforma.

**Hay rastro de todo lo económico.** `money_audit` anota quién marcó cobrado, qué
descuento se aplicó a mano y qué importe cambió —y no registra el total "saliendo
de la nada" al crear el pedido, que no es un cambio.

**Los estados tienen máquina.** No se salta de pendiente a completado ni se
resucita un pedido anulado: las transiciones válidas están declaradas
(`order_transitions`) y los disparadores sellan las horas.

**Las existencias son opcionales por producto.** La mayoría de una carta no se
lleva por unidades; un supermercado sí. Cuando está encendido, la venta consume,
hay recuento y hay aviso de mínimos.

---

## Pagos en línea: las pasarelas son datos

El objetivo era que **conectar una pasarela nueva no exija un despliegue**. Una
pasarela REST moderna hace casi siempre lo mismo: te autenticas, le mandas un
importe, te devuelve una dirección a la que enviar al cliente, y más tarde te
avisa por un webhook firmado. Lo único que cambia son los nombres de los campos,
la dirección y cómo se firma.

Todo eso se escribe como **una receta en jsonb**, y entonces dar de alta una
pasarela es rellenar un formulario en `/admin/payments`.

```
payment_providers          la receta: cómo se habla con esa pasarela
country_payment_providers  dónde se ofrece cada una
merchant_payment_methods   qué pasarelas enciende cada comercio, y sus llaves
payment_intents            cada intento de cobro, con su estado
order_payments             el apunte definitivo en el libro
```

**El lenguaje de la receta es pequeño a propósito.** Uno grande acaba siendo un
intérprete de propósito general con las llaves de los cobros. Cubre:
autenticación (ninguna, *bearer*, *basic*, cabecera, OAuth2 en dos pasos),
la petición que abre el cobro con su codificación y sus plantillas
(`{{amount_minor}}`, `{{order_code}}`, `{{webhook_url}}`…), qué extraer de la
respuesta con un mini JSONPath, y cómo verificar el aviso (HMAC SHA-256/512 con
firma por partes, prefijos y plantillas sobre cabeceras y cuerpo).

**Las llaves viven cifradas en Vault**, nunca en una columna. Solo el servidor
las abre, con la llave de servicio, un instante antes de firmar la petición: ni
la sesión de quien paga ni la del dueño del local pueden leerlas. *Tener llaves*
significa **que las llaves existan**, no que quede apuntado un identificador —lo
comprueban por igual el panel, el escaparate y el botón de probar.

**Cada comercio tiene su propio trozo de dirección de aviso**
(`/api/pago/aviso/<token>`), así que el webhook llega ya identificado y solo hay
que comprobar una firma en vez de probarlas todas. Un aviso repetido no cobra dos
veces (índice único sobre proveedor + referencia), uno mal firmado se rechaza con
400, y a lo que no se entiende se contesta 200 para que el proveedor no reintente
durante horas por un motivo que no es suyo.

**Mercado Pago viene de serie** (migración 0063). Se eligió antes que Stripe a
propósito: Stripe es la más cómoda y por eso enseña menos. Mercado Pago trae dos
rarezas que ninguna receta contemplaba —su aviso no dice si el pago salió bien
(hay que ir a preguntarlo) y firma un manifiesto en vez del cuerpo—, y
encontrarlas con una sola pasarela conectada es mucho más barato que con cuatro.

### Lo que ve cada uno

- **La plataforma** (`/admin/payments`) da de alta la pasarela y escribe su
  receta, y decide en qué países se ofrece.
- **El comercio** (`/dashboard/payments`) ve solo las de su país, mete sus
  llaves y pulsa **Guardar y probar**: se guardan, se prueba la conexión contra
  la API real con un importe mínimo y, si contesta, la pasarela queda encendida.
  Ahí está también la dirección de aviso que hay que pegar en el panel del
  proveedor.
- **El cliente**, en el checkout, ve dos grupos: **pagar ahora** (las pasarelas
  encendidas) y **pagar al recibir / al recoger / en la mesa** (efectivo o
  tarjeta). "Tarjeta" y "Datáfono TPV" son la misma casilla para el cliente
  —pagar con tarjeta al recibir—; cuál de las dos se anota depende de lo que el
  comercio tenga activado.

---

## Países y ciudades los pone la plataforma

Estaban escritos en el código, que es tanto como decir que añadir Guatemala
exigía un despliegue. Y la lista era la misma para todos: un local de Tegucigalpa
elegía entre veintitantos países y ciento y pico ciudades para encontrar la suya.

Ahora los mantiene el superadministrador en `/admin/places`. Cada país trae su
**divisa**, su **zona horaria** y las **pasarelas disponibles allí**; dentro de
cada país, sus ciudades. El comercio elige de un desplegable corto y correcto, y
esa elección es la que filtra qué pasarelas se le ofrecen.

Se leen **sin sesión** a propósito: el alta de un comercio ocurre antes de que
haya sesión. Crearlos, solo la plataforma.

Hoy: **23 países y 95 ciudades**. Los mercados de salida son **Colombia, Honduras
y España**.

---

## Cómo gana dinero la plataforma

| Vía | Cómo |
|---|---|
| **Cuota** | Planes de suscripción, cobrados por Stripe o asignados a mano. La suscripción pertenece a un *sujeto* —un negocio o una persona—, así que también se le puede cobrar a un repartidor |
| **Comisión** | Se devenga como apuntes (`platform_commissions`), no se calcula al vuelo: cada línea guarda la tarifa que se le aplicó. Se agrupa en liquidaciones |
| **Destacados** | Lo único de lo que la plataforma tiene existencias limitadas es la atención de quien abre la aplicación con hambre. Se vende por fechas y ciudad, con aforo y con hueco consultable antes de contratar |
| **Facturas** | `platform_invoices`, con la plataforma como emisor y su propia identidad fiscal |

Un comercio deja de servir su catálogo en cuanto su suscripción caduca: la
comprobación vive en `restaurant_is_live()` y la aplican las políticas RLS, así
que no depende de que el código se acuerde de mirarlo.

---

## Seguridad

**RLS está activo y forzado en las 55 tablas.** Ninguna se queda sin puerta, y
las que no tienen política es a propósito.

**La base ya no nace abierta.** En esta instalación todo lo que se creaba nacía
con permisos completos para `anon` y `authenticated`. La barrera era la política
RLS y la comprobación que cada función lleva dentro: aguantaba, pero era una
barrera de un solo hilo. Las migraciones 0057 y 0058 cerraron los permisos y
concedieron solo lo que hace falta.

Costó descubrir por qué la primera no sirvió de nada: **PostgreSQL concede
`EXECUTE` a PUBLIC en cada función que se crea**, y `alter default privileges …
revoke execute … from public` no lo suprime. Por eso la migración 0062 instala un
**disparador de evento** que cierra cada función nueva en el momento de crearla:
para que no haya que acordarse.

De 125 funciones ejecutables sin sesión se pasó a **31**, y hay un trinquete en
las pruebas: esa cifra solo puede bajar. Las 16 llamadas anónimas contra el
dinero rebotan **en la capa de permisos**, antes de llegar a la comprobación
interna.

**Los pedidos no se escriben desde el navegador.** El cliente llama a
`place_order()`, una función `SECURITY DEFINER` que recalcula todos los precios
desde la base: los importes que manda el navegador se ignoran. El impuesto se
calcula sobre la base ya descontada, y el descuento nunca supera el subtotal.

**El seguimiento sin cuenta** usa `get_order_by_token()`, que devuelve únicamente
los campos que necesita la pantalla de estado. Lo mismo hace
`payment_intent_state()` para la pantalla de vuelta de la pasarela: quien paga
puede no tener cuenta, y necesita saber si su pago llegó sin poder mirar nada
más.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Salta RLS. Solo servidor: invitaciones, webhook de Stripe y **las llaves de las pasarelas** | Sí |
| `NEXT_PUBLIC_SITE_URL` | Base de los QR, de los enlaces y de las direcciones de aviso | Sí en producción |
| `SUPABASE_STUDIO_URL` · `SUPABASE_STUDIO_AUTH` | Solo herramientas: migraciones, tipos y pruebas | Para desarrollo |
| `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Cobro de **suscripciones** de la plataforma | Opcional |
| `SMTP_*` | Correo de la aplicación: invitaciones y avisos de cuenta | Opcional |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | Notificaciones push | Opcional |

Sin claves de Stripe la aplicación funciona entera; solo el botón de renovar
avisa de que los pagos no están configurados, y el superadministrador puede
asignar y prorrogar planes a mano. **Stripe cobra las suscripciones de la
plataforma; las ventas de los comercios van por las pasarelas configurables**,
que son otra cosa y no dependen de estas variables.

La clave pública de push se lee **en ejecución** (`VAPID_PUBLIC_KEY`, sin
prefijo `NEXT_PUBLIC_`) porque las variables `NEXT_PUBLIC_` se congelan al
compilar y añadirlas al despliegue después no servía de nada.

---

## Base de datos

Las migraciones de `supabase/migrations/` se aplican **en orden**. Son 69 y las
lleva un runner propio:

```bash
npm run db:status     # qué falta, qué cambió
npm run db:migrate    # aplica lo que falte
npm run db:check      # ¿los ficheros describen la base?
npm run db:types      # regenera src/types/database.ts
```

`migrate.py` envuelve cada fichero en su transacción, guarda la huella de lo
aplicado en `schema_migrations` y **se niega a seguir si un fichero ya aplicado
cambió en disco**. `db:check` replica los eventos de creación y borrado en orden
para comparar lo declarado con lo que hay vivo: es lo que impide que la base y
el repositorio se separen sin que nadie se entere.

| Migraciones | Qué traen |
|---|---|
| `0001`–`0016` | Cimientos: esquema, RLS, `place_order`, almacenamiento, planes, ciudades, banners, repartidores, marca, cupones, equipo y catálogo global de categorías |
| `0017`–`0034` | La operación diaria: pantallas de bienvenida editables, métricas, push, documento fiscal del comercio, banners de plataforma, sala, valoraciones, turno de mesa, quién tomó la comanda, "servido", y el flujo completo de reparto |
| `0035`–`0044` | Auditoría del dinero (fases 0–3): cobros como apuntes, caja y turno con descuadre, rastro económico, documento fiscal numerado, máquina de estados y existencias |
| `0045`–`0048` | Fases A–C: lo que se vendía y no existía, la suscripción por sujeto, la comisión sobre ventas y las facturas de la plataforma |
| `0049`–`0053` | Fase D: supermercados, pasillos, franjas de entrega y alta masiva del catálogo |
| `0054`–`0056` | Fase E: destacados en la portada, con su hueco y su ingreso |
| `0057`, `0058`, `0062` | Cerrar los permisos, y el disparador para que no haya que acordarse |
| `0059`–`0061`, `0063` | Cobro en línea: la forma de pago, las tres tablas, el ciclo del cobro y Mercado Pago |
| `0064`, `0065` | Lo que se ejecuta solo también necesita permiso: columnas generadas |
| `0066` | Países y ciudades los pone la plataforma |
| `0067`–`0069` | Las etiquetas de Mercado Pago, el estado del pago para quien paga, y que tener llaves sea que las llaves existan |

Estado actual de la base: **55 tablas · 138 funciones · 29 enumerados · 69
migraciones aplicadas · RLS en todas · 31 funciones ejecutables sin sesión**.

`supabase/seed-demo.sql` crea un comercio de ejemplo con carta, mesas y cuentas.
Las contraseñas llegan por entorno para que el archivo pueda vivir en el
repositorio:

```bash
DEMO_ADMIN_PW=... DEMO_OWNER_PW=... DEMO_KITCHEN_PW=... DEMO_COURIER_PW=... \
SUPABASE_STUDIO_AUTH=usuario:contraseña \
python3 scripts/seed-demo.py
```

---

## Pruebas

```bash
npm test            # las de base de datos
npm run verify      # tipos, estilo, migraciones y pruebas
npm run test:navegador   # que las pantallas abran (necesita el servidor)
```

Cada suite **monta su propio local** —usuarios, equipo, repartidor, carta y
suscripción viva— y lo desmonta al terminar, también si algo revienta a mitad.
No tocan datos reales. Las sesiones son de verdad: se entra por la API de
autenticación con el correo y la contraseña de cada rol y las llamadas van por
PostgREST, que es la única forma de probar lo que aquí importa —las políticas de
acceso y los permisos—; con un superusuario no se vería ninguna.

| Suite | Qué cubre |
|---|---|
| `dinero.py` | Cobrar y quién puede, cierre sin cobrar, cobro dividido, devoluciones, anulaciones, la caja del turno con su efectivo esperado, el dinero del repartidor y su liquidación, y que el rastro no se pueda borrar |
| `ajustes.py` | Que el local pueda guardar su ficha, campo a campo, y que los países y ciudades estén donde deben |
| `superficie_publica.py` | Dieciséis llamadas sin sesión contra el dinero, lectura anónima de tablas sensibles, y dos trinquetes: que no crezca lo que `anon` ejecuta y que ninguna tabla quede sin RLS |
| `pasarelas.py` | Levanta una pasarela **de mentira**, la da de alta escribiendo su receta y cobra de punta a punta: llaves, redirección, aviso firmado, apunte, comisión, aviso repetido y aviso falsificado |
| `mercadopago.py` | La pasarela de verdad, contra su API real. Necesita `MP_ACCESS_TOKEN`; sin él se salta |
| `navegador.mjs` | Que abran el escaparate sin sesión, el panel del comercio, la cocina y el de la plataforma, sin errores en consola |

Última tanda: **81 comprobaciones en verde** con la aplicación apagada (la de
Mercado Pago se saltó, y con ella la del panel de cobro); con el servidor
levantado y el testigo de Mercado Pago puesto pasan de cien. `npm run lint`: 0
errores, 11 avisos. `npm run db:check`: los ficheros describen la base.

**El trinquete.** `superficie_publica.py` guarda un techo de funciones
ejecutables sin sesión, y esa cifra solo puede bajar. Subirla tiene que costar
una línea visible en un `git diff`.

Si una tanda muere a mitad, la siguiente barre lo que dejó: los locales cuyo
identificador empieza por `arnes-`, los usuarios del dominio `yumi.test` y los
secretos de Vault que se quedaron sin dueño.

---

## Estructura

```
src/
├── app/
│   ├── (storefront)/       portada, búsqueda, carrito, favoritos, pedidos, perfil
│   ├── r/[slug]/           catálogo del comercio, producto, carrito, checkout, mesa
│   ├── m/[code]/           entrada de los QR de mesa
│   ├── order/[token]/      seguimiento público del pedido
│   ├── pago/[intento]/     vuelta de la pasarela
│   ├── courier/            panel del repartidor
│   ├── dashboard/          panel del comercio (16 secciones)
│   ├── kitchen/            pantalla de cocina
│   ├── admin/              superadministración (13 secciones)
│   ├── onboarding/         alta guiada de un comercio nuevo
│   └── api/                QR, push, Stripe y cobro en línea (iniciar · aviso)
├── components/             ui, storefront, product, dashboard, kitchen, admin, courier, auth, pwa
├── i18n/                   diccionarios es/en y proveedor
├── lib/
│   ├── payments/           el intérprete de recetas: tipos, plantilla, firma, motor, probar
│   ├── queries/            lecturas compartidas (pedidos, cupones, público, lugares)
│   └── …                   supabase, auth, dinero, carrito, correo, push, utilidades
└── types/                  tipos generados de la base de datos

scripts/
├── migrate.py              aplica migraciones y lleva la cuenta
├── gen-db-types.py         tipos de TypeScript desde el esquema real
├── checks/                 ¿los ficheros describen la base?
└── pruebas/                el arnés y las suites
```

Unas 47.000 líneas de TypeScript en 255 ficheros.

---

## Decisiones que conviene conocer

**Los importes se guardan como enteros en la unidad menor de la divisa.** 12,50 €
son 1250. Cuántos decimales tiene esa unidad depende de la divisa (EUR 2, COP 0,
KWD 3), por eso cada comercio guarda `currency` y `currency_decimals`. El formato
siempre usa coma decimal, sea cual sea la divisa.

**El importe viaja dos veces hacia la pasarela.** En unidades menores y en
mayores, y estas últimas como número *y* como texto: Mercado Pago quiere `20000`
y PayPal quiere `"10.00"`, y mandar el tipo equivocado da un error que no dice
cuál es el problema.

**Un `return` de plpgsql no deshace lo ya escrito.** Una función no es una
transacción propia. La primera importación masiva comprobaba el tope del plan
dentro del bucle que daba de alta, y al llegar al límite dejaba el catálogo a
medias. Ahora decide antes de escribir, en dos fases.

**Una columna generada la evalúa quien escribe la fila**, no el dueño de la
tabla. Al cerrar los permisos, `restaurants.city_slug` dejó de poder calcularse y
el guardado entero de los ajustes se cayó con «permission denied for function
slugify». Y no bastaba con conceder esa: hay que conceder **la cadena entera**,
porque `slugify` llama por dentro a `unaccent_fallback`.

**El aviso de una pasarela no siempre dice si el pago salió bien.** Mercado Pago
manda un identificador y hay que ir a preguntar. Por eso la receta tiene un paso
de *resolución*: el aviso trae la referencia, y una segunda llamada trae el
estado.

**El seguimiento del pedido va por sondeo, no por Realtime.** El cliente es
anónimo y Realtime necesita una sesión que satisfaga RLS. El panel y la cocina,
que sí tienen sesión, usan Realtime.

**El historial de estados lo escriben dos triggers.** Las marcas de tiempo se
sellan en `BEFORE` (para que viajen en la misma fila) y el evento se inserta en
`AFTER`, cuando el pedido ya existe y la clave foránea se puede satisfacer.

**El alto de las pantallas de acción es fijo, no mínimo.** En el carrito y en los
avisos de mesa el scroll vive dentro de la lista, para que el botón de acción no
acabe por debajo del borde. Restar píxeles a ojo no servía: la cabecera y la
barra inferior cambian de alto entre móvil y escritorio.

**Detrás de un proxy, `request.url` es la dirección interna.** Redirigir con ella
mandaba los QR de mesa a `localhost`. El origen público se saca de las cabeceras
`x-forwarded-*` en `lib/request-url.ts`, y solo si faltan se recurre a
`NEXT_PUBLIC_SITE_URL`.

**El service worker es deliberadamente conservador.** El catálogo, los precios y
el estado de los pedidos cambian a cada momento: no se cachea nada de eso, solo
el armazón estático y una página de respaldo sin conexión.

**Los tipos de la base se generan contra el esquema real** con
`scripts/gen-db-types.py`, que consulta el endpoint pg-meta del Studio. No hace
falta la CLI de Supabase ni abrir el puerto 5432.

---

## Correo

Los correos salen de **dos sitios distintos**, y confundirlos es la causa
habitual de "he puesto el SMTP y sigue sin funcionar el registro":

| Qué correo | Quién lo manda | Dónde se configura |
|---|---|---|
| Confirmación de registro, recuperación y cambio de correo | GoTrue (Supabase Auth) | Variables del despliegue de **Supabase** |
| Invitación al equipo y avisos de cuenta | La aplicación | `SMTP_*` en `.env.local` |

La instancia exige confirmar el correo (`mailer_autoconfirm = false`), así que
sin el SMTP de GoTrue nadie puede registrarse. Las variables exactas están en
[`docs/correo.md`](docs/correo.md); las de push, en
[`docs/notificaciones-push.md`](docs/notificaciones-push.md).

---

## Lo que falta

Lo inmediato, para cerrar el cobro en línea:

- **Volver a meter las credenciales de Mercado Pago** en La Trattoria y pegar la
  dirección de aviso en el panel del proveedor, de donde sale la clave secreta
  del webhook (solo aparece después de guardar).
- **Un pago completo de punta a punta** con un usuario de prueba, que es la
  última milla que no se puede automatizar.

Lo planificado y no hecho:

| Bloque | Qué |
|---|---|
| 3 | Stripe, PayPal y Bold como recetas —el intérprete ya está; son datos |
| 5 | Devoluciones **reales** contra la pasarela, no solo el apunte contrario |
| 6 | Redsys, que firma distinto a todas las demás (España) |
| 7 | Datáfonos en la nube: mandar el cobro al terminal desde el TPV |
| 8 | Límite de peticiones en las rutas públicas |
| 9 | Vigilancia y copias de seguridad comprobadas |
| 10 | Exportación contable |

Fuera de alcance por ahora: el puente con un datáfono local (necesita software en
el equipo de caja) y la facturación electrónica por país (DIAN en Colombia, SAR
en Honduras, Verifactu en España), que son proyectos por sí mismos.

---

## Comandos

```bash
npm run dev         # desarrollo
npm run build       # compilación de producción
npm run start       # servidor de producción
npm run lint        # ESLint
npm run typecheck   # TypeScript sin emitir
npm run verify      # tipos + estilo + migraciones + pruebas
npm run db:status   # estado de las migraciones
npm run db:migrate  # aplicar las que falten
npm run db:check    # ¿los ficheros describen la base?
npm run db:types    # regenerar src/types/database.ts
npm test            # pruebas de base de datos
```

## Pila

Next.js 15.5 (App Router, Server Actions) · React 19 · TypeScript estricto ·
Tailwind CSS 3 · Supabase autoalojado (Postgres, Auth, Storage, Realtime, Vault) ·
Stripe para las suscripciones · pasarelas de pago como datos ·
`<model-viewer>` · Zustand · PWA con service worker propio ·
Playwright para las pruebas de navegador ·
Diseño basado en el Figma [menu-app](https://www.figma.com/design/TVU2oHj08Qkm5WqEI5JRK7/menu-app)
