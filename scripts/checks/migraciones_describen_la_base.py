#!/usr/bin/env python3
"""
Comprueba que los ficheros de migración describen la base que hay en marcha.

No es lo mismo que probar que una base vacía queda idéntica —eso pide un
entorno aparte— pero sí atrapa el fallo que importa para poder reproducir la
instalación: que un fichero declare algo que en producción no está, o que
producción tenga algo que ningún fichero crea.

Cuenta las bajas: un objeto creado en una migración y borrado en otra posterior
no tiene por qué existir, y darlo por perdido sería un falso positivo.

Salida:  0 todo cuadra · 1 hay diferencias
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
CARPETA = RAIZ / "supabase" / "migrations"

# La tabla de control la crea el ejecutor, no una migración, porque una
# migración que la creara necesitaría que ya existiera para poder anotarse.
FUERA_DE_CUENTA = {"schema_migrations"}

INVENTARIO = """
select
 (select coalesce(jsonb_agg(c.relname), '[]') from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r') as tablas,
 (select coalesce(jsonb_agg(distinct p.proname), '[]') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public') as funciones,
 (select coalesce(jsonb_agg(t.typname), '[]') from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e') as tipos;
"""


def declarado() -> dict[str, set[str]]:
    """
    Reproduce el estado final leyendo las migraciones en orden.

    No vale con juntar las creaciones y restar las bajas: varias funciones se
    borran y se vuelven a crear más adelante —`place_order` cambió de firma dos
    veces— y tratarlo como conjuntos las daba por muertas. Lo que cuenta es el
    último acto sobre cada objeto, así que los sucesos se reproducen en el orden
    en que ocurren, fichero a fichero y línea a línea.
    """
    sucesos: list[tuple[int, str, str, bool]] = []   # (posición, tipo, nombre, ¿alta?)

    patrones = [
        ("tablas",    r"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)", True),
        ("tablas",    r"drop\s+table\s+(?:if\s+exists\s+)?public\.(\w+)", False),
        ("funciones", r"create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(", True),
        ("funciones", r"drop\s+function\s+(?:if\s+exists\s+)?public\.(\w+)", False),
        ("tipos",     r"create\s+type\s+(?:public\.)?(\w+)\s+as\s+enum", True),
        ("tipos",     r"drop\s+type\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)", False),
    ]

    desplazamiento = 0
    for ruta in sorted(CARPETA.glob("*.sql")):
        texto = ruta.read_text()
        for tipo, patron, alta in patrones:
            for coincidencia in re.finditer(patron, texto, re.I):
                sucesos.append((desplazamiento + coincidencia.start(), tipo, coincidencia.group(1), alta))
        desplazamiento += len(texto) + 1

    estado: dict[str, set[str]] = {"tablas": set(), "funciones": set(), "tipos": set()}
    for _, tipo, nombre, alta in sorted(sucesos):
        estado[tipo].add(nombre) if alta else estado[tipo].discard(nombre)
    return estado


def en_la_base() -> dict[str, set[str]]:
    sys.path.insert(0, str(RAIZ / "scripts"))
    from migrate import consulta  # reutiliza la conexión del ejecutor

    fila = consulta(INVENTARIO)[0]
    return {clave: set(valor) for clave, valor in fila.items()}


def main() -> int:
    esperado, real = declarado(), en_la_base()
    problemas = 0

    for etiqueta in ("tablas", "funciones", "tipos"):
        faltan = sorted(esperado[etiqueta] - real[etiqueta])
        sobran = sorted(real[etiqueta] - esperado[etiqueta] - FUERA_DE_CUENTA)

        print(f"{etiqueta}: {len(esperado[etiqueta])} en los ficheros · {len(real[etiqueta])} en la base")
        if faltan:
            problemas += len(faltan)
            print(f"  DECLARADO Y NO EXISTE: {', '.join(faltan)}")
        if sobran:
            problemas += len(sobran)
            print(f"  EXISTE Y NADIE LO CREA: {', '.join(sobran)}")

    if problemas:
        print(f"\n{problemas} diferencias. La instalación no se puede reproducir desde los ficheros.")
        return 1

    print("\nLos ficheros describen la base.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
