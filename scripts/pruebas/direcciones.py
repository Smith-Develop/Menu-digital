#!/usr/bin/env python3
"""
Una ciudad no es una dirección.

El checkout enseñaba «Usando tu dirección guardada: Dabeiba» y mandaba eso al
repartidor. No fue un fallo sino cuatro encadenados, y el de abajo es el que
importa aquí: `place_order` sólo exigía que la dirección no viniera vacía, así
que el nombre de una ciudad le valía.

Esta suite comprueba las dos mitades del arreglo. Que la base rechace lo que no
es una dirección y no deje que nadie use la ficha de otro, y que la libreta se
cuide sola: la primera manda, sólo hay una de siempre, y borrarla asciende a la
siguiente en vez de dejar el hueco.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arnes import Cuaderno, Escenario, error_de, rest, rpc, sql  # noqa: E402

ok = lambda r: isinstance(r, list) and len(r) > 0   # noqa: E731


def correr(c: Cuaderno, esc: Escenario) -> None:
    cliente = esc.tokens["cliente"]
    otro = esc.tokens["owner"]
    yo = esc.usuarios["cliente"]

    def guardar(token: str, fila: dict):
        return rest(token, "customer_addresses", "POST", fila)

    def mias():
        return rest(
            cliente,
            "customer_addresses?select=id,street,city,full_line,is_default&order=created_at",
        )

    # ------------------------------------------------------------------
    c.bloque("Lo que no es una dirección")

    for texto, deberia in (
        ("Dabeiba", False),
        ("dabeiba", False),
        ("Madrid", False),
        ("Bogotá", False),
        ("Bogota", False),          # sin tilde, que es como lo teclea la gente
        ("Casa", False),            # demasiado corto para llegar a ninguna parte
        ("Cra 45 # 12-34", True),
        ("Calle Mayor 8, 3ºB", True),
    ):
        dice = sql(f"select public.address_looks_complete('{texto}') as v;")[0]["v"]
        c.check(f"«{texto}» {'sí' if deberia else 'no'} es una dirección", dice is deberia)

    # ------------------------------------------------------------------
    c.bloque("La libreta se cuida sola")

    r = guardar(cliente, {"user_id": yo, "city": "Dabeiba", "street": "Cra 45 # 12-34",
                          "label": "Casa", "notes": "Portón verde"})
    c.check("el cliente guarda su dirección", ok(r), str(r)[:160])

    filas = mias()
    c.check("y queda de predeterminada sin pedirlo",
            len(filas) == 1 and filas[0]["is_default"] is True, str(filas)[:160])
    c.check("la línea se compone sola",
            filas[0]["full_line"] == "Cra 45 # 12-34, Dabeiba", str(filas[0]["full_line"]))

    # Las restricciones de la tabla: la misma regla, escrita donde no se puede
    # saltar ni por la API, ni por el TPV, ni por una importación.
    r = guardar(cliente, {"user_id": yo, "city": "Dabeiba", "street": "Dabeiba"})
    c.check("la calle no puede ser la ciudad", not ok(r), str(r)[:160])

    r = guardar(cliente, {"user_id": yo, "city": "Dabeiba", "street": "Casa"})
    c.check("ni una palabra suelta", not ok(r), str(r)[:160])

    r = guardar(cliente, {"user_id": yo, "city": "Dabeiba", "street": "Calle 80 # 20-15",
                          "label": "Trabajo"})
    c.check("guarda una segunda", ok(r), str(r)[:160])

    filas = mias()
    cuantas = sum(1 for f in filas if f["is_default"])
    c.check("y sigue habiendo una sola de siempre", cuantas == 1, f"{cuantas} predeterminadas")

    segunda = next(f["id"] for f in filas if not f["is_default"])
    rpc(cliente, "set_default_address", {"p_id": segunda})
    filas = mias()
    c.check("cambiar de predeterminada no deja dos",
            sum(1 for f in filas if f["is_default"]) == 1
            and next(f["id"] for f in filas if f["is_default"]) == segunda,
            str(filas)[:200])

    # ------------------------------------------------------------------
    c.bloque("Lo mío es mío")

    ajenas = rest(otro, "customer_addresses?select=id")
    mios = {f["id"] for f in filas}
    c.check("otra persona no ve mis direcciones",
            isinstance(ajenas, list) and not any(f["id"] in mios for f in ajenas),
            str(ajenas)[:160])

    rest(otro, f"customer_addresses?id=eq.{segunda}", "PATCH", {"street": "Robada 123"})
    sigue = sql(f"select street from public.customer_addresses where id = '{segunda}';")[0]["street"]
    c.check("ni las puede cambiar", sigue != "Robada 123", sigue)

    # ------------------------------------------------------------------
    c.bloque("Pedir a donde se puede llegar")

    def pedir(**extra):
        return rpc(cliente, "place_order", {
            "p_restaurant_slug": f"arnes-{esc.sufijo}",
            "p_items": [{"product_id": esc.productos["Plato barato"], "quantity": 1}],
            "p_type": "delivery",
            "p_payment_method": "cash",
            "p_customer_name": "Quien pide",
            **extra,
        })

    r = pedir(p_address="Dabeiba")
    c.check("la ciudad sola ya no cuela como dirección",
            error_de(r) == "ADDRESS_INCOMPLETE", str(r)[:160])

    r = pedir(p_address="")
    c.check("y sin nada tampoco", error_de(r) == "ADDRESS_REQUIRED", str(r)[:160])

    # El camino del TPV: por teléfono no hay ficha que elegir y la dirección se
    # dicta de viva voz, así que el texto libre tiene que seguir valiendo.
    r = pedir(p_address="Cra 45 # 12-34, apto 201")
    c.check("una dirección dictada a mano sí vale", isinstance(r, dict) and "id" in r, str(r)[:160])

    r = pedir(p_address_id=segunda)
    c.check("y una ficha de la libreta también", isinstance(r, dict) and "id" in r, str(r)[:160])
    pedido = r["id"]

    fila = sql(f"""
        select address, address_id, address_snapshot->>'street' as calle
          from public.orders where id = '{pedido}';
    """)[0]
    c.check("el pedido guarda la línea compuesta",
            fila["address"] == "Calle 80 # 20-15, Dabeiba", str(fila["address"]))
    c.check("y de qué ficha salió", fila["address_id"] == segunda, str(fila["address_id"]))
    c.check("y una copia de cómo estaba entonces",
            fila["calle"] == "Calle 80 # 20-15", str(fila["calle"]))

    # Lo que impide mandarle la cena a casa de otro conociendo un identificador.
    ajena = sql(f"""
        insert into public.customer_addresses (user_id, city, street)
        values ('{esc.usuarios["cajero"]}', 'Madrid', 'Calle del Cajero 1')
        returning id;
    """)[0]["id"]
    r = pedir(p_address_id=ajena)
    c.check("no se puede pedir a la dirección de otro",
            error_de(r) == "ADDRESS_NOT_YOURS", str(r)[:160])

    # ------------------------------------------------------------------
    c.bloque("Borrar la de siempre no deja hueco")

    sql(f"delete from public.customer_addresses where id = '{segunda}';")
    filas = mias()
    c.check("asciende la siguiente",
            len(filas) >= 1 and sum(1 for f in filas if f["is_default"]) == 1,
            f"{len(filas)} direcciones, {sum(1 for f in filas if f['is_default'])} de siempre")

    fila = sql(f"""
        select address, address_id, address_snapshot->>'street' as calle
          from public.orders where id = '{pedido}';
    """)[0]
    c.check("y el pedido que la usó conserva la dirección",
            fila["address"] == "Calle 80 # 20-15, Dabeiba"
            and fila["calle"] == "Calle 80 # 20-15",
            f"{fila['address']} · {fila['calle']}")
    c.check("aunque la ficha ya no exista", fila["address_id"] is None, str(fila["address_id"]))
