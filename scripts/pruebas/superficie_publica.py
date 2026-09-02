#!/usr/bin/env python3
"""
Qué puede hacer alguien que llega sin sesión.

La auditoría encontró que en este esquema todo nace abierto: `anon` ejecuta
cualquier función y escribe en cualquier tabla nueva, y lo único que lo frena es
la comprobación que cada función lleva dentro. Aguanta —lo comprobé una por una—
pero la primera que se escriba sin ella queda pública el mismo día.

Esta prueba hace tres cosas:

  1. Llama sin sesión a las funciones que mueven dinero y exige que todas
     rechacen. Esto pasa hoy y tiene que seguir pasando.
  2. Cuenta cuántas funciones puede ejecutar `anon` y falla si el número sube.
     Es un trinquete: la cifra sólo puede bajar, y bajará de golpe cuando se
     cierren los permisos por defecto (bloque 0.3 del plan).
  3. Comprueba que ninguna tabla se queda sin RLS, que es el fallo que dejó
     expuesta la tabla `_f`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arnes import Cuaderno, Escenario, error_de, rest, rpc, sql  # noqa: E402

# El escaparate necesita estas sin sesión: un cliente pide sin registrarse.
NECESARIAS = {
    "place_order", "get_order_by_token", "call_waiter",
    "list_cities", "nearest_city", "home_banners", "active_notifications",
    "catalog_tree", "available_delivery_slots", "restaurant_is_open_now",
    "delivery_allowed", "sponsored_restaurants", "unit_price_cents",
}

# Cuántas funciones puede ejecutar `anon`. Sólo puede bajar.
#
# Eran 125 —todas— porque el motor concede la ejecución a PUBLIC al crear cada
# función y la instalación añadía la suya por defecto. Las migraciones 0057 y
# 0058 cerraron las dos puertas y dejaron sólo lo concedido a mano: veintinueve,
# que son las del escaparate más las que usan las políticas por dentro.
#
# Subir esta cifra tiene que costar una línea en un `git diff`.
TECHO = 29

# Tabla que crea el ejecutor de migraciones, cerrada a propósito y sin políticas.
SIN_POLITICA_A_PROPOSITO = {"schema_migrations"}


def correr(c: Cuaderno, esc: Escenario) -> None:
    local = esc.restaurante

    # -----------------------------------------------------------------
    c.bloque("Sin sesión, contra el dinero")
    p = rpc(esc.tokens["cliente"], "place_order", {
        "p_restaurant_slug": f"arnes-{esc.sufijo}",
        "p_items": [{"product_id": esc.productos["Plato caro"], "quantity": 1}],
        "p_type": "delivery", "p_payment_method": "cash",
        "p_customer_name": "Cliente", "p_address": "Calle 1"})
    linea = rest(esc.tokens["owner"], f"order_items?order_id=eq.{p['id']}&select=id")[0]["id"]
    nadie = "00000000-0000-0000-0000-000000000000"

    intentos = [
        ("marcar pagado",        "mark_order_paid",   {"p_order_id": p["id"], "p_method": "cash"}),
        ("anular",               "cancel_order",      {"p_order_id": p["id"], "p_reason": "robo"}),
        ("apuntar un cobro",     "add_order_payment", {"p_order_id": p["id"], "p_method": "cash",
                                                       "p_amount_cents": 1, "p_note": None}),
        ("devolver",             "refund_order",      {"p_order_id": p["id"], "p_reason": "robo",
                                                       "p_amount_cents": 100, "p_method": "cash"}),
        ("invitar",              "apply_manual_discount", {"p_order_id": p["id"], "p_cents": 9999,
                                                           "p_reason": "robo"}),
        ("quitar una línea",     "void_order_item",   {"p_item_id": linea, "p_reason": "robo"}),
        ("abrir caja",           "open_cash_session", {"p_restaurant_id": local, "p_float_cents": 0,
                                                       "p_note": None}),
        ("sacar de la caja",     "add_cash_movement", {"p_restaurant_id": local, "p_kind": "withdrawal",
                                                       "p_amount_cents": 10000, "p_reason": "robo"}),
        ("liquidar repartidor",  "settle_courier_cash", {"p_courier_id": esc.repartidor,
                                                         "p_restaurant_id": local}),
        ("tocar existencias",    "adjust_stock",      {"p_product_id": esc.productos["Bebida"],
                                                       "p_kind": "adjustment", "p_qty": 999,
                                                       "p_reason": "robo"}),
        ("importar catálogo",    "import_products",   {"p_restaurant_id": local,
                                                       "p_rows": [{"name": "Intruso", "price_cents": 1}],
                                                       "p_dry_run": False}),
        ("preparar un pedido",   "pick_order_item",   {"p_item_id": linea, "p_qty": 0, "p_note": "robo"}),
        ("regalarse un destacado", "reserve_sponsorship", {"p_restaurant_id": local, "p_kind": "listing",
                                                           "p_starts_on": "2030-01-01",
                                                           "p_ends_on": "2030-01-05"}),
        ("activar un destacado", "activate_sponsorship", {"p_id": nadie}),
        ("liquidar comisiones",  "settle_platform_commissions", {"p_subject_type": "restaurant",
                                                                 "p_subject_id": local, "p_note": None}),
        ("emitir factura",       "issue_platform_invoice", {"p_settlement_id": nadie, "p_tax_rate": 0}),
    ]

    colados, por_permiso, por_comprobacion = [], 0, 0
    for nombre, funcion, argumentos in intentos:
        respuesta = rpc(None, funcion, argumentos)
        mensaje = respuesta.get("message", "") if isinstance(respuesta, dict) else ""
        codigo = error_de(respuesta)

        if "permission denied" in mensaje.lower():
            por_permiso += 1
        elif codigo.startswith("FORBIDDEN") or codigo in ("NOT_A_COURIER", "PLAN_NO_POOL"):
            por_comprobacion += 1
        else:
            colados.append(f"{nombre} -> {str(respuesta)[:80]}")

    c.check(f"las {len(intentos)} llamadas anónimas al dinero rebotan", not colados,
            " | ".join(colados))

    # Desde el bloque 0.3 la primera barrera es el permiso, no la comprobación
    # que la función lleva dentro. Las dos siguen ahí; lo que cambia es cuál
    # actúa primero, y que ahora hay dos.
    c.check("y rebotan ya en la capa de permisos, no en la comprobación interna",
            por_permiso == len(intentos),
            f"{por_permiso} por permiso · {por_comprobacion} por comprobación interna")

    # Y que tampoco pueda leer nada.
    filtrados = []
    for tabla in ("orders", "order_payments", "cash_sessions", "money_audit", "profiles",
                  "platform_commissions", "sponsorships", "subscriptions", "restaurant_staff",
                  "schema_migrations"):
        filas = rest(None, f"{tabla}?select=*&limit=1")
        if isinstance(filas, list) and filas:
            filtrados.append(tabla)
    c.check("ninguna tabla sensible se lee sin sesión", not filtrados, ", ".join(filtrados))

    # -----------------------------------------------------------------
    c.bloque("La superficie no crece")
    ejecutables = {
        f["proname"] for f in sql("""
            select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
        """)
    }
    c.check(f"anon ejecuta {len(ejecutables)} funciones, y el techo son {TECHO}",
            len(ejecutables) <= TECHO,
            f"han aparecido {len(ejecutables) - TECHO} nuevas desde la última revisión")

    faltan = NECESARIAS - ejecutables
    c.check("el escaparate conserva las que necesita", not faltan, ", ".join(sorted(faltan)))

    # -----------------------------------------------------------------
    c.bloque("Ninguna tabla sin puerta")
    sueltas = [
        f["relname"] for f in sql("""
            select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
        """)
    ]
    c.check("todas las tablas tienen RLS", not sueltas, ", ".join(sueltas))

    sin_politica = [
        f["relname"] for f in sql("""
            select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
               and not exists (select 1 from pg_policies p
                                where p.schemaname = 'public' and p.tablename = c.relname);
        """)
    ] 
    inesperadas = set(sin_politica) - SIN_POLITICA_A_PROPOSITO
    c.check("y las que no tienen política es a propósito", not inesperadas, ", ".join(sorted(inesperadas)))


def main() -> int:
    c = Cuaderno("Superficie pública")
    with Escenario() as esc:
        correr(c, esc)
    print(f"\n  {c.bien} bien · {c.mal} mal")
    return 1 if c.mal else 0


if __name__ == "__main__":
    sys.exit(main())
