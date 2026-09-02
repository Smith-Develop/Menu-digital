#!/usr/bin/env python3
"""
Las reglas del dinero, comprobadas sobre un local de pruebas.

Es la suite que más importa: son las invariantes que, si se rompen, no dan un
error visible sino un descuadre que alguien descubre semanas después contando
billetes. Cada comprobación va con la sesión del rol que corresponde, porque la
mitad de estas reglas son de permiso y con un superusuario no se verían.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arnes import Cuaderno, Escenario, error_de, rest, rpc, sql  # noqa: E402


def pedido(esc: Escenario, articulos: list[tuple[str, int]], tipo: str = "delivery",
           metodo: str = "cash") -> dict:
    """Levanta un pedido como cliente y devuelve lo que contestó la base."""
    return rpc(esc.tokens["cliente"], "place_order", {
        "p_restaurant_slug": f"arnes-{esc.sufijo}",
        "p_items": [{"product_id": esc.productos[n], "quantity": q} for n, q in articulos],
        "p_type": tipo,
        "p_payment_method": metodo,
        "p_customer_name": "Cliente del arnés",
        "p_customer_phone": "600000000",
        "p_address": "Calle del arnés 1" if tipo == "delivery" else None,
    })


def llevar_a(token: str, identificador: str, destino: str) -> None:
    """
    Recorre la máquina de estados hasta el destino.

    No se puede saltar de pendiente a listo: la tabla de transiciones sólo
    admite los pasos que ocurren de verdad en un local, y las pruebas tienen que
    caminarlos igual que los camina el equipo.
    """
    camino = {"confirmed": ["confirmed"], "ready": ["confirmed", "ready"]}
    for paso in camino[destino]:
        rest(token, f"orders?id=eq.{identificador}", "PATCH", {"status": paso})


def correr(c: Cuaderno, esc: Escenario) -> None:
    duenyo, cajero, cocina, repartidor = (
        esc.tokens["owner"], esc.tokens["cajero"], esc.tokens["cocina"], esc.tokens["repartidor"]
    )
    local = esc.restaurante

    def orden(identificador: str) -> dict:
        return rest(duenyo, f"orders?id=eq.{identificador}&select=*")[0]

    # ---------------------------------------------------------------
    c.bloque("Cobrar")
    p = pedido(esc, [("Plato caro", 1)])          # 20,00 + 2,00 IVA + 3,30 envío = 25,30
    c.check("el pedido sale con el total que toca", p.get("total_cents") == 2530, str(p)[:200])

    r = rpc(cocina, "mark_order_paid", {"p_order_id": p["id"], "p_method": "cash"})
    c.check("la cocina no cobra", error_de(r) == "FORBIDDEN_CHARGE", str(r)[:150])

    r = rpc(cajero, "mark_order_paid", {"p_order_id": p["id"], "p_method": "cash"})
    c.check("el cajero sí cobra", isinstance(r, dict) and r.get("ok"), str(r)[:150])

    o = orden(p["id"])
    c.check("queda cobrado por completo", o["paid_cents"] == 2530 and o["payment_status"] == "paid",
            f"{o['paid_cents']} · {o['payment_status']}")

    # ---------------------------------------------------------------
    c.bloque("Cerrar sin cobrar")
    sin_pagar = pedido(esc, [("Plato barato", 1)])
    r = rest(cajero, f"orders?id=eq.{sin_pagar['id']}", "PATCH", {"status": "completed"})
    c.check("la máquina de estados no deja saltar de pendiente a terminado",
            error_de(r) == "INVALID_TRANSITION", str(r)[:150])

    r = rest(cajero, f"orders?id=eq.{sin_pagar['id']}", "PATCH", {"status": "confirmed"})
    r = rest(cajero, f"orders?id=eq.{sin_pagar['id']}", "PATCH", {"status": "ready"})
    c.check("el cajero no marca listo un pedido", error_de(r) == "ROLE_CANNOT_TRANSITION", str(r)[:150])

    llevar_a(duenyo, sin_pagar["id"], "ready")
    r = rest(cajero, f"orders?id=eq.{sin_pagar['id']}", "PATCH", {"status": "completed"})
    c.check("y estando listo, tampoco se cierra sin cobrar",
            error_de(r) == "PAYMENT_REQUIRED", str(r)[:150])

    # ---------------------------------------------------------------
    c.bloque("Cobro dividido")
    dividido = pedido(esc, [("Plato caro", 2)])   # 40,00 + 4,00 + 3,30 = 47,30
    rpc(cajero, "add_order_payment",
        {"p_order_id": dividido["id"], "p_method": "cash", "p_amount_cents": 2000, "p_note": None})
    o = orden(dividido["id"])
    c.check("un pago parcial no cierra la cuenta",
            o["paid_cents"] == 2000 and o["payment_status"] != "paid", str(o["paid_cents"]))

    rpc(cajero, "add_order_payment",
        {"p_order_id": dividido["id"], "p_method": "card", "p_amount_cents": 2730, "p_note": None})
    o = orden(dividido["id"])
    c.check("el resto la cierra", o["paid_cents"] == 4730 and o["payment_status"] == "paid",
            f"{o['paid_cents']} · {o['payment_status']}")

    apuntes = rest(duenyo, f"order_payments?order_id=eq.{dividido['id']}&select=method,amount_cents")
    c.check("quedan los dos apuntes, cada uno con su método",
            len(apuntes) == 2 and {a["method"] for a in apuntes} == {"cash", "card"}, str(apuntes)[:200])

    # ---------------------------------------------------------------
    c.bloque("Devolver")
    r = rpc(cajero, "refund_order", {"p_order_id": dividido["id"], "p_reason": "prueba",
                                     "p_amount_cents": 1000, "p_method": "cash"})
    c.check("el cajero no devuelve dinero", error_de(r) == "FORBIDDEN_REFUND", str(r)[:150])

    rpc(duenyo, "refund_order", {"p_order_id": dividido["id"], "p_reason": "plato frío",
                                 "p_amount_cents": 1000, "p_method": "cash"})
    o = orden(dividido["id"])
    c.check("devolver baja lo cobrado", o["refunded_cents"] == 1000 and o["paid_cents"] == 3730,
            f"devuelto {o['refunded_cents']} · cobrado {o['paid_cents']}")

    r = rpc(duenyo, "refund_order", {"p_order_id": dividido["id"], "p_reason": "otra vez",
                                     "p_amount_cents": 999999, "p_method": "cash"})
    o = orden(dividido["id"])
    c.check("no se puede devolver más de lo cobrado", o["refunded_cents"] <= 4730,
            f"devuelto {o['refunded_cents']}")

    # ---------------------------------------------------------------
    c.bloque("Quitar líneas e invitar")
    con_lineas = pedido(esc, [("Plato caro", 1), ("Bebida", 2)])
    lineas = rest(duenyo, f"order_items?order_id=eq.{con_lineas['id']}&select=id,line_total_cents")
    antes = con_lineas["total_cents"]

    r = rpc(cocina, "void_order_item", {"p_item_id": lineas[0]["id"], "p_reason": "prueba"})
    c.check("la cocina no quita líneas", error_de(r) == "FORBIDDEN_VOID", str(r)[:150])

    r = rpc(duenyo, "void_order_item", {"p_item_id": lineas[0]["id"], "p_reason": ""})
    c.check("quitar una línea exige motivo", error_de(r) == "VOID_REASON_REQUIRED", str(r)[:150])

    rpc(duenyo, "void_order_item", {"p_item_id": lineas[0]["id"], "p_reason": "se cayó"})
    o = orden(con_lineas["id"])
    c.check("el total baja al quitar la línea", o["total_cents"] < antes,
            f"{antes} -> {o['total_cents']}")

    otras = rest(duenyo, f"order_items?order_id=eq.{con_lineas['id']}&voided_at=is.null&select=id")
    r = rpc(duenyo, "void_order_item", {"p_item_id": otras[0]["id"], "p_reason": "y esta"})
    c.check("no se puede dejar el pedido vacío quitando líneas",
            error_de(r) == "LAST_ITEM", str(r)[:150])

    rpc(duenyo, "apply_manual_discount",
        {"p_order_id": con_lineas["id"], "p_cents": 100, "p_reason": "invitación"})
    o = orden(con_lineas["id"])
    c.check("la invitación queda anotada con su motivo",
            o["manual_discount_cents"] == 100 and o["discount_reason"] == "invitación",
            f"{o['manual_discount_cents']} · {o['discount_reason']}")

    # ---------------------------------------------------------------
    c.bloque("Anular")
    r = rpc(cajero, "cancel_order", {"p_order_id": con_lineas["id"], "p_reason": "prueba"})
    c.check("el cajero no anula", error_de(r) == "FORBIDDEN_CANCEL", str(r)[:150])

    r = rpc(duenyo, "cancel_order", {"p_order_id": con_lineas["id"], "p_reason": ""})
    c.check("anular exige motivo", error_de(r) == "CANCEL_REASON_REQUIRED", str(r)[:150])

    rpc(duenyo, "cancel_order", {"p_order_id": con_lineas["id"], "p_reason": "el cliente se fue"})
    o = orden(con_lineas["id"])
    c.check("el pedido queda anulado con su motivo y su autor",
            o["status"] == "cancelled" and o["cancel_reason"] == "el cliente se fue"
            and o["cancelled_by"] is not None, str(o["status"]))

    # ---------------------------------------------------------------
    c.bloque("La caja del turno")
    apertura = rpc(cajero, "open_cash_session",
                   {"p_restaurant_id": local, "p_float_cents": 5000, "p_note": None})
    sesion = apertura.get("session_id") if isinstance(apertura, dict) else None
    c.check("se abre la caja con su fondo", bool(sesion), str(apertura)[:200])

    en_caja = pedido(esc, [("Plato barato", 2)])   # 10,00 + 1,00 + 3,30 = 14,30
    rpc(cajero, "mark_order_paid", {"p_order_id": en_caja["id"], "p_method": "cash"})
    esperado = rpc(cajero, "expected_cash", {"p_session_id": sesion})
    c.check("lo cobrado en efectivo entra en la caja", esperado == 5000 + 1430, str(esperado))

    con_tarjeta = pedido(esc, [("Plato barato", 1)])
    rpc(cajero, "mark_order_paid", {"p_order_id": con_tarjeta["id"], "p_method": "card"})
    esperado_2 = rpc(cajero, "expected_cash", {"p_session_id": sesion})
    c.check("lo cobrado con tarjeta no entra en la caja", esperado_2 == esperado, str(esperado_2))

    rpc(cajero, "add_cash_movement", {"p_restaurant_id": local, "p_kind": "withdrawal",
                                      "p_amount_cents": 1000, "p_reason": "al banco"})
    esperado_3 = rpc(cajero, "expected_cash", {"p_session_id": sesion})
    c.check("una retirada baja lo esperado", esperado_3 == esperado - 1000, str(esperado_3))

    cierre = rpc(cajero, "close_cash_session",
                 {"p_session_id": sesion, "p_counted_cents": esperado_3 - 250, "p_note": "faltan 2,50"})
    c.check("el cierre calcula la diferencia",
            isinstance(cierre, dict) and cierre.get("variance_cents") == -250, str(cierre)[:200])

    # ---------------------------------------------------------------
    c.bloque("El dinero que lleva el repartidor")
    reparto = pedido(esc, [("Plato caro", 1)])
    llevar_a(duenyo, reparto["id"], "ready")
    r = rpc(repartidor, "courier_take_order", {"p_order_id": reparto["id"]})
    c.check("el repartidor recoge el pedido", isinstance(r, dict) and r.get("ok"), str(r)[:200])

    r = rpc(repartidor, "courier_deliver_order", {"p_order_id": reparto["id"]})
    c.check("y lo entrega cobrando", isinstance(r, dict) and r.get("ok"), str(r)[:200])

    o = orden(reparto["id"])
    c.check("el pedido queda cobrado en la calle", o["paid_cents"] == o["total_cents"],
            f"{o['paid_cents']} de {o['total_cents']}")

    deuda = rpc(duenyo, "restaurant_cash_due", {"p_restaurant_id": local})
    c.check("ese efectivo consta como deuda del repartidor",
            isinstance(deuda, list) and len(deuda) == 1 and deuda[0]["cents"] == o["total_cents"],
            str(deuda)[:200])

    r = rpc(repartidor, "settle_courier_cash", {"p_courier_id": esc.repartidor, "p_restaurant_id": local})
    c.check("el repartidor no se salda a sí mismo", error_de(r) == "FORBIDDEN_SETTLE", str(r)[:150])

    rpc(duenyo, "settle_courier_cash", {"p_courier_id": esc.repartidor, "p_restaurant_id": local})
    deuda = rpc(duenyo, "restaurant_cash_due", {"p_restaurant_id": local})
    c.check("liquidar deja la deuda a cero", deuda == [], str(deuda)[:200])

    # ---------------------------------------------------------------
    c.bloque("El rastro")
    rastro = rest(duenyo, f"money_audit?restaurant_id=eq.{local}&select=action")
    acciones = {f["action"] for f in rastro} if isinstance(rastro, list) else set()
    c.check("lo que se corrigió a mano deja huella",
            {"discount", "cancel", "void_item"} <= acciones, str(sorted(acciones)))

    apuntes = rest(duenyo, f"order_payments?restaurant_id=eq.{local}&select=kind,created_by")
    tipos = {a["kind"] for a in apuntes} if isinstance(apuntes, list) else set()
    c.check("y los cobros y devoluciones quedan en el libro, con su autor",
            {"charge", "refund"} <= tipos and all(a["created_by"] for a in apuntes),
            str(sorted(tipos)))

    r = rest(duenyo, f"money_audit?restaurant_id=eq.{local}", "DELETE")
    quedan = rest(duenyo, f"money_audit?restaurant_id=eq.{local}&select=id")
    c.check("y esa huella no se puede borrar", isinstance(quedan, list) and len(quedan) == len(rastro),
            f"{len(rastro)} -> {len(quedan) if isinstance(quedan, list) else '?'}")


def main() -> int:
    c = Cuaderno("Reglas del dinero")
    with Escenario() as esc:
        correr(c, esc)
    print(f"\n  {c.bien} bien · {c.mal} mal")
    return 1 if c.mal else 0


if __name__ == "__main__":
    sys.exit(main())
