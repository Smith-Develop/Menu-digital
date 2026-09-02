# Pruebas

```
npm test               # las de base de datos
npm run test:dinero    # sólo las reglas del dinero
npm run test:navegador  # que las pantallas abran (necesita el servidor en marcha)
npm run verify         # tipos, estilo, migraciones y pruebas
```

La de navegador pide las cuentas por entorno, porque son las de la instalación
contra la que se prueba: `PRUEBAS_OWNER_EMAIL`, `PRUEBAS_OWNER_PASSWORD`,
`PRUEBAS_ADMIN_EMAIL`, `PRUEBAS_ADMIN_PASSWORD` y, si no es local, `PRUEBAS_URL`.
Sin ellas avisa y se sale, en vez de fallar.

## Cómo funcionan

Cada suite monta **su propio local** —usuarios, equipo, repartidor, carta y
suscripción viva— y lo desmonta al terminar, también si una comprobación
revienta a mitad. No tocan ningún dato real: se pueden ejecutar tantas veces
como haga falta sin mirar antes qué había.

Las sesiones son de verdad. Se entra por la API de autenticación con el correo y
la contraseña de cada rol, y las llamadas van por PostgREST. Es la única forma de
probar lo que de verdad importa aquí, que son las políticas de acceso y las
comprobaciones de permiso: con un superusuario no se vería ninguna.

## Qué cubren hoy

- **`dinero.py`** · cobrar y quién puede, cerrar sin cobrar, cobro dividido,
  devoluciones, quitar líneas, invitar, anular, la caja del turno con su efectivo
  esperado, el dinero que lleva el repartidor y su liquidación, y que el rastro
  no se pueda borrar.
- **`navegador.mjs`** · que abran el escaparate sin sesión, las once pantallas
  del panel del restaurante, la de cocina y las cinco del superadministrador, y
  que ninguna deje errores en la consola.
- **`superficie_publica.py`** · dieciséis llamadas sin sesión contra las
  funciones que mueven dinero, lectura anónima de las tablas sensibles, y dos
  trinquetes: que no crezca el número de funciones que `anon` puede ejecutar y
  que ninguna tabla se quede sin RLS.

## El trinquete

`superficie_publica.py` guarda un techo: cuántas funciones puede ejecutar `anon`.
Esa cifra sólo puede bajar. Eran 125 —todas— y son 29 desde que las migraciones
0057 y 0058 cerraron los permisos. Subirla tiene que costar una línea visible en
un `git diff`.

## Restos

Si una tanda muere a mitad, la siguiente barre lo que dejó antes de empezar: los
locales cuyo identificador empieza por `arnes-` y los usuarios del dominio
`yumi.test`, que está reservado para esto.
