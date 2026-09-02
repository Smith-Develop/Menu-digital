# Pruebas

```
npm test            # todas
npm run test:dinero # sólo las reglas del dinero
npm run verify      # tipos, estilo, migraciones y pruebas
```

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
- **`superficie_publica.py`** · dieciséis llamadas sin sesión contra las
  funciones que mueven dinero, lectura anónima de las tablas sensibles, y dos
  trinquetes: que no crezca el número de funciones que `anon` puede ejecutar y
  que ninguna tabla se quede sin RLS.

## El trinquete

`superficie_publica.py` guarda un techo: cuántas funciones puede ejecutar `anon`
hoy. Esa cifra sólo puede bajar. Está alta porque en este esquema todo nace
abierto por privilegio por defecto, y bajará de golpe a trece cuando se cierren
los permisos. Mientras tanto, impide que empeore.

## Restos

Si una tanda muere a mitad, la siguiente barre lo que dejó antes de empezar: los
locales cuyo identificador empieza por `arnes-` y los usuarios del dominio
`yumi.test`, que está reservado para esto.
