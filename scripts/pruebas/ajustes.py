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


    c.bloque("El país, que es lo que filtra las pasarelas")

    # El país deja de escribirse a mano porque es la llave del filtro de
    # pasarelas: «CO» escrito de tres formas son tres países para ese filtro, y
    # el comercio se queda sin ninguna forma de cobro sin saber por qué.
    from countries import PAISES_CON_CIUDADES  # noqa: E402

    for codigo, ciudad, divisa in PAISES_CON_CIUDADES:
        r = guardar(duenyo, {"country": codigo, "city": ciudad})
        c.check(f"se guarda {ciudad} ({codigo})", isinstance(r, list) and len(r) == 1, str(r)[:140])

    fila = rest(duenyo, f"restaurants?id=eq.{local}&select=country,city_slug")[0]
    c.check("y el identificador de ciudad sale sin tildes ni espacios",
            fila["city_slug"] == "san-pedro-sula", str(fila))


    c.bloque("Los países los pone la plataforma")

    # Estaban en el código, de modo que abrir Guatemala exigía un despliegue y
    # todos los locales elegían entre la misma lista larga.
    paises = rest(duenyo, "platform_countries?select=code,name,currency&is_active=eq.true")
    c.check("hay países dados de alta", isinstance(paises, list) and len(paises) > 0, str(paises)[:120])

    sin_sesion = rest(None, "platform_countries?select=code&limit=1")
    c.check("y se leen sin sesión, porque el alta ocurre antes de tenerla",
            isinstance(sin_sesion, list) and len(sin_sesion) == 1, str(sin_sesion)[:120])

    r = rest(duenyo, "platform_countries", "POST", {"code": "ZZ", "name": "Inventado",
                                                    "currency": "EUR", "timezone": "UTC"})
    c.check("pero sólo la plataforma los crea",
            not (isinstance(r, list) and len(r) == 1), str(r)[:140])

    ciudades_es = rest(None, "platform_cities?select=name&country=eq.ES&is_active=eq.true")
    c.check("cada país trae las suyas",
            isinstance(ciudades_es, list) and any(x["name"] == "Madrid" for x in ciudades_es),
            str(ciudades_es)[:120])

    cobertura = rest(None, "country_payment_providers?select=provider_id&country=eq.CO")
    c.check("y las pasarelas que se ofrecen allí",
            isinstance(cobertura, list) and len(cobertura) > 0, str(cobertura)[:120])


def main() -> int:
    c = Cuaderno("Que el local pueda guardar su ficha")
    with Escenario() as esc:
        correr(c, esc)
    print(f"\n  {c.bien} bien · {c.mal} mal")
    return 1 if c.mal else 0


if __name__ == "__main__":
    sys.exit(main())
