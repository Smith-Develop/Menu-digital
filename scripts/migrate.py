#!/usr/bin/env python3
"""
Aplica las migraciones que falten y lleva la cuenta de cuáles están puestas.

Hasta ahora los ficheros de `supabase/migrations/` se ejecutaban a mano por el
endpoint del Studio, sin registro y sin orden garantizado. Eso hacía imposible
dos cosas que ya hacen falta: levantar una segunda instalación desde cero, y
saber con certeza qué tiene aplicado producción.

La tabla de control se crea desde aquí y no desde una migración, porque la
migración que la creara necesitaría que ya existiera para poder anotarse. Es el
mismo arranque que usan todas las herramientas de este tipo.

Uso:
    python3 scripts/migrate.py                 aplica lo que falte
    python3 scripts/migrate.py --status        qué falta, qué cambió
    python3 scripts/migrate.py --dry-run       dice qué haría, sin tocar nada
    python3 scripts/migrate.py --baseline      marca lo existente como aplicado
    python3 scripts/migrate.py --allow-drift   aplica aunque haya deriva

Salida:
    0  todo en orden
    1  error al aplicar
    2  hay deriva: un fichero ya aplicado cambió en disco
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CARPETA = RAIZ / "supabase" / "migrations"


def entorno() -> tuple[str, str]:
    """Las variables reales mandan; si no están, se leen de .env.local."""
    url = os.environ.get("SUPABASE_STUDIO_URL", "")
    auth = os.environ.get("SUPABASE_STUDIO_AUTH", "")

    fichero = RAIZ / ".env.local"
    if (not url or not auth) and fichero.exists():
        for linea in fichero.read_text().splitlines():
            linea = linea.strip()
            if not linea or linea.startswith("#") or "=" not in linea:
                continue
            clave, valor = linea.split("=", 1)
            clave, valor = clave.strip(), valor.strip()
            if clave == "SUPABASE_STUDIO_URL" and not url:
                url = valor
            elif clave == "SUPABASE_STUDIO_AUTH" and not auth:
                auth = valor

    if not url:
        sys.exit("Falta SUPABASE_STUDIO_URL, en el entorno o en .env.local.")
    return url.rstrip("/"), auth


URL, AUTH = entorno()
ENDPOINT = f"{URL}/api/platform/pg-meta/default/query"


def consulta(sql: str):
    """Ejecuta SQL y devuelve las filas, o corta con el error de Postgres."""
    orden = [
        "curl", "-s", "-m", "600", "-X", "POST", ENDPOINT,
        "-H", "Content-Type: application/json",
        "-H", "x-connection-encrypted: 1",
        "--data-binary", "@-",
    ]
    if AUTH:
        orden[2:2] = ["-u", AUTH]

    salida = subprocess.run(
        orden, input=json.dumps({"query": sql}), capture_output=True, text=True
    ).stdout

    try:
        datos = json.loads(salida)
    except json.JSONDecodeError:
        raise RuntimeError(f"respuesta que no es JSON: {salida[:400]}")

    # pg-meta devuelve una lista con las filas, o un objeto con el error.
    if isinstance(datos, dict):
        raise RuntimeError(datos.get("formattedError") or datos.get("message") or salida[:400])
    return datos


def arranque() -> None:
    """
    Crea la tabla de control.

    Sin política y sin permisos: sólo la toca quien entra por debajo de RLS. Es
    la primera tabla que se escribe después de descubrir que en este esquema
    todo nace abierto para `anon`, así que empieza cerrada a propósito.
    """
    consulta("""
        create table if not exists public.schema_migrations (
          version     text primary key,
          checksum    text not null,
          applied_at  timestamptz not null default now(),
          duration_ms integer
        );
        alter table public.schema_migrations enable row level security;
        alter table public.schema_migrations force row level security;
        revoke all on public.schema_migrations from anon, authenticated;
    """)


def huella(ruta: Path) -> str:
    return hashlib.sha256(ruta.read_bytes()).hexdigest()[:16]


def en_disco() -> list[tuple[str, Path, str]]:
    """Los ficheros, en el orden en que hay que aplicarlos."""
    return [
        (ruta.name, ruta, huella(ruta))
        for ruta in sorted(CARPETA.glob("*.sql"))
    ]


def aplicadas() -> dict[str, str]:
    filas = consulta("select version, checksum from public.schema_migrations;")
    return {f["version"]: f["checksum"] for f in filas}


def aplicar(nombre: str, ruta: Path, checksum: str) -> None:
    """
    Aplica un fichero entero dentro de una transacción.

    El endpoint respeta `begin`/`commit`, de modo que una migración que falle a
    mitad no deja la base con medio cambio puesto. Lo comprobé antes de confiar
    en ello, no lo di por hecho.
    """
    sql = ruta.read_text()
    inicio = time.time()
    consulta(f"begin;\n{sql}\ncommit;")
    ms = int((time.time() - inicio) * 1000)

    consulta(
        "insert into public.schema_migrations (version, checksum, duration_ms) "
        f"values ('{nombre}', '{checksum}', {ms});"
    )
    print(f"  aplicada  {nombre}  ({ms} ms)")


def main() -> int:
    args = set(sys.argv[1:])
    solo_estado = "--status" in args
    ensayo = "--dry-run" in args
    baseline = "--baseline" in args
    permitir_deriva = "--allow-drift" in args

    arranque()
    ficheros = en_disco()
    ya = aplicadas()

    pendientes = [(n, r, c) for n, r, c in ficheros if n not in ya]
    deriva = [n for n, _, c in ficheros if n in ya and ya[n] != c]
    huerfanas = [n for n in ya if n not in {f[0] for f in ficheros}]

    if baseline:
        # Marca lo que hay en disco como ya aplicado. Sólo es cierto si esos
        # ficheros son exactamente los que se ejecutaron: por eso se hace una
        # vez, a conciencia, y no automáticamente.
        for nombre, _, checksum in pendientes:
            consulta(
                "insert into public.schema_migrations (version, checksum) "
                f"values ('{nombre}', '{checksum}') on conflict (version) do nothing;"
            )
        print(f"Marcadas {len(pendientes)} migraciones como aplicadas.")
        return 0

    print(f"{len(ficheros)} en disco · {len(ya)} aplicadas · {len(pendientes)} pendientes")

    if huerfanas:
        print("\nAplicadas pero ya no están en disco:")
        for nombre in sorted(huerfanas):
            print(f"  {nombre}")

    if deriva:
        print("\nDERIVA: estos ficheros cambiaron después de aplicarse.")
        print("Lo que hay en la base ya no es lo que dice el fichero.")
        for nombre in deriva:
            print(f"  {nombre}")
        if not permitir_deriva and not solo_estado:
            print("\nCorrige la diferencia con una migración nueva, o pasa --allow-drift.")
            return 2

    if pendientes:
        print("\nPendientes:")
        for nombre, _, _ in pendientes:
            print(f"  {nombre}")

    if solo_estado or ensayo:
        return 2 if deriva else 0

    if not pendientes:
        print("\nNada que aplicar.")
        return 2 if deriva else 0

    print()
    for nombre, ruta, checksum in pendientes:
        try:
            aplicar(nombre, ruta, checksum)
        except RuntimeError as error:
            print(f"\n  FALLÓ  {nombre}\n{error}")
            print("\nLa transacción se revirtió: la base queda como estaba antes de este fichero.")
            return 1

    print(f"\n{len(pendientes)} aplicadas.")
    return 2 if deriva else 0


if __name__ == "__main__":
    sys.exit(main())
