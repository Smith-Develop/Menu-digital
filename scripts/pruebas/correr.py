#!/usr/bin/env python3
"""
Ejecuta todas las suites y devuelve un solo veredicto.

Barre primero los escenarios que hayan quedado sueltos de una tanda anterior
cortada a mitad: si no, sus restos ensucian la medida y desconciertan a quien
lea el resultado.
"""
import importlib
import sys
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))

from arnes import Cuaderno, Escenario, limpiar_huerfanos  # noqa: E402

SUITES = ["dinero", "superficie_publica", "pasarelas"]


def main() -> int:
    sueltos = limpiar_huerfanos()
    if sueltos:
        print(f"Barridos {sueltos} escenarios de una ejecución anterior.")

    inicio = time.time()
    bien = mal = 0

    for nombre in SUITES:
        modulo = importlib.import_module(nombre)

        # Las que atraviesan la aplicación entera necesitan el servidor; si no
        # está, se saltan con un aviso en vez de fallar.
        if hasattr(modulo, "aplicacion_en_marcha") and not modulo.aplicacion_en_marcha():
            print(f"\n{modulo.__doc__.strip().splitlines()[0]}")
            print("    saltada · no hay aplicación levantada")
            continue

        cuaderno = Cuaderno(modulo.__doc__.strip().splitlines()[0])
        # Cada suite estrena escenario: así una que ensucie no arrastra a la
        # siguiente, y cualquiera se puede ejecutar suelta.
        with Escenario() as escenario:
            modulo.correr(cuaderno, escenario)
        bien += cuaderno.bien
        mal += cuaderno.mal

    segundos = time.time() - inicio
    print(f"\n{'─' * 52}")
    print(f"{bien} bien · {mal} mal · {segundos:.0f} s")
    return 1 if mal else 0


if __name__ == "__main__":
    sys.exit(main())
