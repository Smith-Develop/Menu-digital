# Migraciones

Cada cambio de esquema es un fichero numerado en esta carpeta. No se editan los
ya aplicados: lo que está mal se corrige con uno nuevo.

```
npm run db:status     # qué falta y qué ha cambiado
npm run db:migrate    # aplica lo pendiente, en orden
npm run db:check      # ¿describen estos ficheros la base que hay?
```

## Cómo lleva la cuenta

`public.schema_migrations` guarda qué se aplicó, con la huella del fichero y
cuánto tardó. La crea el propio ejecutor y no una migración, porque una
migración que la creara necesitaría que ya existiera para poder anotarse.

Nace cerrada: con RLS activada, sin políticas y sin permisos para `anon` ni
`authenticated`. En este esquema todo lo demás nació abierto, y esta tabla se
escribió después de descubrirlo.

## Deriva

Si un fichero cambia después de aplicarse, `db:status` lo dice y `db:migrate` se
niega a seguir. Lo que hay en la base ya no es lo que dice el fichero, y aplicar
lo siguiente sobre esa base es construir sobre algo que nadie ha leído. Para
saltárselo a conciencia: `--allow-drift`.

## Transacciones

Cada fichero se aplica dentro de su propia transacción. Una migración que falle
a la mitad no deja medio cambio puesto. Está comprobado, no supuesto.

## El punto de partida

Las 56 primeras migraciones se aplicaron a mano antes de que existiera el
ejecutor, y se marcaron como aplicadas con `--baseline`. Eso da por bueno que
los ficheros en disco son exactamente los que se ejecutaron; `npm run db:check`
lo confirma comparando tablas, funciones y tipos con los que hay en la base.

Lo que esa comprobación **no** prueba es que una base vacía quede idéntica
ejecutando los 56 ficheros. Para eso hace falta un segundo entorno, y es lo
primero que habrá que montar cuando exista.
