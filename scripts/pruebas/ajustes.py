#!/usr/bin/env python3
"""
Que el local pueda guardar su ficha.

Existe por un fallo que cometí: al cerrar los permisos del bloque 0.3, la ficha
del restaurante dejó de poder guardarse y el error no lo decía —«permission
denied for function slugify»—. `city_slug` es una columna generada, y la
expresión de una columna generada la evalúa quien escribe la fila, no el dueño
de la tabla.

La lección no es «acordarse de slugify»: es que ese camino sólo se descubre
intentándolo. Buscar las funciones que aparecen en una columna generada tampoco
basta, porque cada una puede llamar a otras —y así fue: `slugify` llamaba a
`unaccent_fallback`, y el guardado siguió fallando después del primer arreglo—.

Lo que sí basta es esto: guardar la ficha y ver si se puede.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arnes import Cuaderno, Escenario, error_de, rest  # noqa: E402


def correr(c: Cuaderno, esc: Escenario) -> None:
    duenyo, cocina = esc.tokens["owner"], esc.tokens["cocina"]
    local = esc.restaurante

    def guardar(token: str, cambios: dict):
        return rest(token, f"restaurants?id=eq.{local}", "PATCH", cambios)

    c.bloque("La ficha, campo a campo")

    # Cada uno por separado, como los guarda ahora la pantalla por pestañas: si
    # un camino se rompe, el informe dice cuál.
    for nombre, cambio in (
        ("el nombre", {"name": "Local del arnés, renombrado"}),
        ("la ciudad", {"city": "Bogotá"}),          # dispara la columna generada
        ("la dirección", {"address": "Calle 1"}),
        ("la divisa", {"currency": "COP", "currency_decimals": 0}),
        ("el horario", {"opening_hours": {"1": [["09:00", "17:00"]]}}),
        ("abrir y cerrar", {"is_open": False}),
        ("los métodos de pago", {"accepts_card": False}),
        ("los colores", {"primary_color": "#123456"}),
    ):
        r = guardar(duenyo, cambio)
        c.check(f"el dueño guarda {nombre}", isinstance(r, list) and len(r) == 1, str(r)[:160])

    fila = rest(duenyo, f"restaurants?id=eq.{local}&select=city,city_slug,currency")[0]
    c.check("la ciudad recalcula su identificador",
            fila["city_slug"] == "bogota" and fila["currency"] == "COP", str(fila))

    c.bloque("Y sólo el dueño")
    r = guardar(cocina, {"name": "Cocina manda"})
    c.check("la cocina no toca la ficha", isinstance(r, list) and len(r) == 0, str(r)[:160])


def main() -> int:
    c = Cuaderno("Que el local pueda guardar su ficha")
    with Escenario() as esc:
        correr(c, esc)
    print(f"\n  {c.bien} bien · {c.mal} mal")
    return 1 if c.mal else 0


if __name__ == "__main__":
    sys.exit(main())
