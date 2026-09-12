#!/usr/bin/env python3
"""
Cobrar con una pasarela que no existe.

Es la prueba que decide si los cimientos valen. Se levanta una pasarela de
mentira —un servidor mínimo que contesta como contestaría una de verdad— y se da
de alta escribiendo su receta en la base. Si el cobro llega hasta el libro sin
haber escrito una línea de código para ella, entonces conectar Bold, Stripe,
PayPal o MercadoPago es rellenar un formulario.

Lo que se comprueba, por orden de lo que cuesta cuando falla:

  - que el aviso repetido no cobre dos veces
  - que un aviso con firma inválida no cobre nada
  - que el cobro llegue al libro, al pedido y al arqueo
  - que las credenciales no se puedan leer desde una sesión de persona
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arnes import Cuaderno, Escenario, error_de, rest, rpc, sql, sql_falla  # noqa: E402

APP = os.environ.get("PRUEBAS_URL", "http://localhost:3000")
PUERTO = 8799
SECRETO_AVISO = "secreto-de-avisos-de-mentira"
LLAVE = "sk_de_mentira_123"

recibido: dict[str, object] = {}


class Pasarela(BaseHTTPRequestHandler):
    """Contesta como contestaría una pasarela: referencia y sitio a donde ir."""

    def do_POST(self):  # noqa: N802
        largo = int(self.headers.get("Content-Length", 0))
        cuerpo = self.rfile.read(largo).decode()
        recibido["autorizacion"] = self.headers.get("Authorization", "")
        recibido["cuerpo"] = json.loads(cuerpo) if cuerpo else {}

        respuesta = json.dumps({
            "data": {
                "id": "REF-DE-MENTIRA-1",
                "checkout_url": f"http://127.0.0.1:{PUERTO}/pagar/REF-DE-MENTIRA-1",
            }
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(respuesta)))
        self.end_headers()
        self.wfile.write(respuesta)

    def log_message(self, *_):
        pass


def avisar(token: str, cuerpo: dict, firmar_bien: bool = True):
    """Manda el aviso a la aplicación, firmado como lo haría la pasarela."""
    crudo = json.dumps(cuerpo)
    firma = hmac.new(
        (SECRETO_AVISO if firmar_bien else "otro-secreto").encode(),
        crudo.encode(), hashlib.sha256).hexdigest()

    salida = subprocess.run([
        "curl", "-s", "-m", "30", "-w", "\n%{http_code}",
        f"{APP}/api/pago/aviso/{token}",
        "-X", "POST", "-H", "Content-Type: application/json",
        "-H", f"x-firma: {firma}", "-d", crudo,
    ], capture_output=True, text=True).stdout.strip().rsplit("\n", 1)

    return (json.loads(salida[0]) if salida[0].strip() else {}), int(salida[-1])


RECETA = {
    "auth": {"mode": "bearer", "token": "{{secret_key}}"},
    "encoding": "json",
    "create": {
        "method": "POST",
        "url": f"http://127.0.0.1:{PUERTO}/crear",
        "body": {
            "amount": "{{amount_major_text}}",
            "amount_cents": "{{amount_minor}}",
            "currency": "{{currency}}",
            "description": "{{description}}",
            "notify_url": "{{webhook_url}}",
            "return_url": "{{return_url}}",
        },
        "extract": {"redirect_url": "$.data.checkout_url", "reference": "$.data.id"},
    },
    "webhook": {
        "verify": {
            "mode": "hmac_sha256",
            "header": "x-firma",
            "secret": "{{webhook_secret}}",
            "encoding": "hex",
        },
        "reference": "$.payment.id",
        "status": "$.event",
        "map": {"PAGO_APROBADO": "paid", "PAGO_RECHAZADO": "failed"},
        "fee": "$.payment.fee_cents",
    },
}


def literal(valor) -> str:
    """Un valor de Python como literal de texto de SQL, con las comillas dobladas."""
    texto = valor if isinstance(valor, str) else json.dumps(valor)
    return "'" + texto.replace("'", "''") + "'"


def correr(c: Cuaderno, esc: Escenario) -> None:
    duenyo = esc.tokens["owner"]

    # Un secreto de otro, para comprobar que la limpieza no se lo lleva. Existe
    # porque pasó: la limpieza borraba por prefijo y dejó sin credenciales a un
    # local de verdad, con su ficha diciendo que sí las tenía.
    ajeno = sql("""
        select vault.create_secret('{"secret_key":"de-otro"}',
                                   'pago_de_otro_local', 'centinela') as id;
    """)[0]["id"]

    # --- La pasarela de mentira, en marcha ------------------------------
    servidor = HTTPServer(("127.0.0.1", PUERTO), Pasarela)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()

    try:
        # --- Alta, sólo con datos ---------------------------------------
        c.bloque("Dar de alta una pasarela sin tocar código")
        sql(f"""
            delete from public.payment_providers where slug = 'mentira';
            insert into public.payment_providers (slug, name, kind, adapter, spec, config_schema, inline)
            values ('mentira', 'Pasarela de mentira', 'online', 'http',
                    {literal(RECETA)}::jsonb,
                    '[{{"campo":"secret_key","secreto":true}},
                      {{"campo":"public_key","secreto":false}},
                      {{"campo":"webhook_secret","secreto":true}}]'::jsonb,
                    '{{"adapter":"mentira","sdk":"https://ejemplo.invalid/sdk.js",
                       "public_field":"public_key","methods":["card"]}}'::jsonb);
        """)
        proveedor = sql("select id from public.payment_providers where slug='mentira';")[0]["id"]

        metodo = rest(duenyo, "merchant_payment_methods", "POST", {
            "restaurant_id": esc.restaurante, "provider_id": proveedor, "is_active": True,
        })
        c.check("el comercio la enciende desde su panel",
                isinstance(metodo, list) and len(metodo) == 1, str(metodo)[:200])
        metodo_id = metodo[0]["id"]
        token_aviso = metodo[0]["webhook_token"]

        r = rpc(duenyo, "save_merchant_credentials", {
            "p_method_id": metodo_id,
            "p_credentials": {"secret_key": LLAVE, "public_key": "PUB-visible-a-proposito",
                              "webhook_secret": SECRETO_AVISO},
        })
        c.check("y guarda sus llaves", isinstance(r, dict) and r.get("ok"), str(r)[:200])

        fila = rest(duenyo, f"merchant_payment_methods?id=eq.{metodo_id}&select=*")[0]
        c.check("las llaves no se leen desde su propia sesión",
                "secret_key" not in json.dumps(fila) and LLAVE not in json.dumps(fila),
                json.dumps(fila)[:200])

        opciones = rpc(None, "merchant_payment_options", {"p_restaurant_id": esc.restaurante})
        c.check("el escaparate la ve entre las opciones",
                isinstance(opciones, list) and any(o["slug"] == "mentira" for o in opciones),
                str(opciones)[:200])

        # Cobrar dentro de la aplicación obliga a darle al navegador la clave
        # pública del comercio. Es pública por diseño —sólo identifica ante el
        # guion de la pasarela— pero viaja en la misma respuesta que antes no
        # llevaba ninguna credencial, y eso hay que mirarlo de cerca.
        mia = next((o for o in opciones if o["slug"] == "mentira"), {})
        crudo = json.dumps(opciones)

        c.check("el escaparate sabe que cobra por dentro",
                (mia.get("inline") or {}).get("adapter") == "mentira", str(mia)[:200])
        c.check("y recibe la clave pública, que es lo que necesita para cifrar",
                (mia.get("public_config") or {}).get("public_key") == "PUB-visible-a-proposito",
                str(mia.get("public_config"))[:200])
        c.check("pero NO la llave secreta",
                LLAVE not in crudo and "secret_key" not in crudo, crudo[:200])
        c.check("ni el secreto de los avisos",
                SECRETO_AVISO not in crudo and "webhook_secret" not in crudo, crudo[:200])

        # --- El cobro ----------------------------------------------------
        c.bloque("Cobrar de punta a punta")
        pedido = rpc(esc.tokens["cliente"], "place_order", {
            "p_restaurant_slug": f"arnes-{esc.sufijo}",
            "p_items": [{"product_id": esc.productos["Plato caro"], "quantity": 1}],
            "p_type": "delivery", "p_payment_method": "online",
            "p_customer_name": "Quien paga", "p_address": "Calle 1"})
        total = pedido["total_cents"]

        # Lo primero que hay que comprobar del pedido pagado por internet no es
        # que se cobre, sino que NO llegue al local hasta que se cobre. Mientras
        # esto estuvo mal, cada tarjeta rechazada dejaba una comanda en la
        # cocina y alguien se ponía a cocinar lo que nadie había pagado.
        estado = sql(f"select status from public.orders where id = '{pedido['id']}';")[0]["status"]
        c.check("el pedido nace esperando el dinero, no esperando a la cocina",
                estado == "awaiting_payment", estado)

        abiertos = rest(duenyo,
                        "orders?select=id,code&status=in.(pending,confirmed,preparing,ready,served,delivering)"
                        f"&restaurant_id=eq.{esc.restaurante}")
        c.check("y no aparece en el panel del local",
                isinstance(abiertos, list) and all(o["id"] != pedido["id"] for o in abiertos),
                str(abiertos)[:200])

        # Y que esto no se lleve por delante lo de siempre: quien paga en
        # efectivo sigue entrando en el local en el momento de pedir.
        en_efectivo = rpc(esc.tokens["cliente"], "place_order", {
            "p_restaurant_slug": f"arnes-{esc.sufijo}",
            "p_items": [{"product_id": esc.productos["Plato barato"], "quantity": 1}],
            "p_type": "delivery", "p_payment_method": "cash",
            "p_customer_name": "Quien paga a la puerta", "p_address": "Calle 2"})
        estado_efectivo = sql(
            f"select status from public.orders where id = '{en_efectivo['id']}';")[0]["status"]
        c.check("pagando al recibir, el pedido entra como siempre",
                estado_efectivo == "pending", estado_efectivo)

        salida = subprocess.run([
            "curl", "-s", "-m", "40", f"{APP}/api/pago/iniciar",
            "-X", "POST", "-H", "Content-Type: application/json",
            "-d", json.dumps({"orderId": pedido["id"], "methodId": metodo_id,
                              "token": pedido["token"]}),
        ], capture_output=True, text=True).stdout
        inicio = json.loads(salida) if salida.strip() else {}
        c.check("la aplicación abre el cobro y devuelve a dónde ir",
                inicio.get("url", "").endswith("REF-DE-MENTIRA-1"), str(inicio)[:250])

        # Las pasarelas no se ponen de acuerdo: unas quieren el importe como
        # número y otras como texto. La receta elige, y las dos formas salen
        # del mismo importe sin que nadie las calcule a mano.
        c.check("la pasarela recibió el importe en las dos formas que puede pedir",
                recibido.get("cuerpo", {}).get("amount_cents") == total
                and recibido["cuerpo"]["amount"] == f"{total // 100}.{total % 100:02d}",
                json.dumps(recibido.get("cuerpo"))[:220])
        c.check("y la llave secreta, sin que nadie la escribiera en el código",
                recibido.get("autorizacion") == f"Bearer {LLAVE}", str(recibido.get("autorizacion")))
        c.check("le dijimos por dónde avisarnos",
                token_aviso in recibido["cuerpo"].get("notify_url", ""),
                recibido["cuerpo"].get("notify_url", ""))

        intento = sql(f"""select status::text, provider_ref from public.payment_intents
                           where order_id = '{pedido["id"]}';""")[0]
        c.check("el intento queda redirigido con su referencia",
                intento["status"] == "redirected" and intento["provider_ref"] == "REF-DE-MENTIRA-1",
                json.dumps(intento))

        # --- El aviso ----------------------------------------------------
        c.bloque("El aviso")
        cuerpo_aviso = {"event": "PAGO_APROBADO",
                        "payment": {"id": "REF-DE-MENTIRA-1", "fee_cents": 58}}

        respuesta, codigo = avisar(token_aviso, cuerpo_aviso, firmar_bien=False)
        c.check("un aviso mal firmado se rechaza", codigo == 400, f"{codigo} · {respuesta}")
        o = rest(duenyo, f"orders?id=eq.{pedido['id']}&select=paid_cents")[0]
        c.check("y no cobra nada", o["paid_cents"] == 0, str(o))

        respuesta, codigo = avisar(token_aviso, cuerpo_aviso)
        c.check("el aviso bien firmado se acepta", codigo == 200 and respuesta.get("recibido"),
                f"{codigo} · {respuesta}")

        o = rest(duenyo, f"orders?id=eq.{pedido['id']}&select=paid_cents,payment_status")[0]
        entra = sql(f"select status from public.orders where id = '{pedido['id']}';")[0]["status"]
        c.check("y al llegar el dinero, el pedido entra en el local",
                entra == "pending", entra)

        c.check("el pedido queda cobrado",
                o["paid_cents"] == total and o["payment_status"] == "paid", json.dumps(o))

        apunte = rest(duenyo, f"order_payments?order_id=eq.{pedido['id']}&select=*")
        c.check("con su apunte en el libro, su método y su referencia",
                len(apunte) == 1 and apunte[0]["method"] == "online"
                and apunte[0]["provider_ref"] == "REF-DE-MENTIRA-1",
                json.dumps(apunte)[:250])
        c.check("y lo que se queda la pasarela, anotado aparte",
                apunte[0]["fee_cents"] == 58, str(apunte[0].get("fee_cents")))

        # --- Lo que de verdad importa ------------------------------------
        c.bloque("Repetido, tarde y desordenado")
        respuesta, codigo = avisar(token_aviso, cuerpo_aviso)
        c.check("el aviso repetido se acepta sin volver a cobrar", codigo == 200, str(respuesta))

        apunte = rest(duenyo, f"order_payments?order_id=eq.{pedido['id']}&select=id")
        o = rest(duenyo, f"orders?id=eq.{pedido['id']}&select=paid_cents")[0]
        c.check("sigue habiendo un solo apunte",
                len(apunte) == 1 and o["paid_cents"] == total, f"{len(apunte)} apuntes · {o}")

        r = rpc(duenyo, "create_payment_intent", {"p_order_id": pedido["id"],
                                                  "p_method_id": metodo_id})
        c.check("no se puede abrir otro cobro sobre un pedido ya pagado",
                isinstance(r, dict) and "ALREADY_PAID" in str(r.get("message", "")), str(r)[:150])

    finally:
        servidor.shutdown()

        # --- Las tarjetas guardadas --------------------------------------
        c.bloque("Una tarjeta guardada es de quien la guardó")

        # Las escribe el servidor después de hablar con la pasarela, así que
        # aquí se ponen a mano: lo que se está probando es quién las ve.
        cliente_pasarela = sql(f"""
            insert into public.payment_customers
              (restaurant_id, provider_id, user_id, provider_customer_id)
            values ('{esc.restaurante}', '{proveedor}', '{esc.usuarios["cliente"]}', 'cus_de_mentira')
            returning id;
        """)[0]["id"]
        sql(f"""
            insert into public.payment_cards
              (customer_id, provider_card_id, brand, last_four, exp_month, exp_year, is_default)
            values ('{cliente_pasarela}', 'card_de_mentira', 'visa', '4242', 12, 30, true);
        """)

        suyas = rpc(esc.tokens["cliente"], "my_saved_cards", {"p_method_id": metodo_id})
        c.check("el cliente ve la suya",
                isinstance(suyas, list) and len(suyas) == 1 and suyas[0]["last_four"] == "4242",
                str(suyas)[:200])

        # El comercio cobra con ella y aun así no tiene por qué verla. Lo que no
        # se guarda no se filtra, y lo que no se enseña tampoco.
        del_comercio = rest(duenyo, "payment_cards?select=id,last_four")
        c.check("el comercio no ve las tarjetas de su clientela",
                isinstance(del_comercio, list) and len(del_comercio) == 0, str(del_comercio)[:200])

        de_otro = rpc(esc.tokens["cajero"], "my_saved_cards", {"p_method_id": metodo_id})
        c.check("y otra persona tampoco",
                isinstance(de_otro, list) and len(de_otro) == 0, str(de_otro)[:200])

        # Lo que sí se guarda: nunca un número entero. La restricción está para
        # que un error de programación no consiga meterlo.
        r = sql_falla(f"""
            insert into public.payment_cards (customer_id, provider_card_id, last_four)
            values ('{cliente_pasarela}', 'card_larga', '4242424242424242');
        """)
        c.check("no cabe un número de tarjeta donde van cuatro cifras", r is not None, str(r)[:120])

        # --- El pago por adelantado ---------------------------------------
        c.bloque("Si el local lo exige, a domicilio se paga antes")

        sql(f"update public.restaurants set prepay_delivery = true where id = '{esc.restaurante}';")

        def pedir_domicilio(token, metodo_pago):
            return rpc(token, "place_order", {
                "p_restaurant_slug": f"arnes-{esc.sufijo}",
                "p_items": [{"product_id": esc.productos["Plato barato"], "quantity": 1}],
                "p_type": "delivery",
                "p_payment_method": metodo_pago,
                "p_customer_name": "Quien pide",
                "p_address": "Cra 45 # 12-34",
            })

        r = pedir_domicilio(esc.tokens["cliente"], "cash")
        c.check("en efectivo ya no se puede",
                error_de(r) == "PREPAY_REQUIRED", str(r)[:160])

        r = pedir_domicilio(esc.tokens["cliente"], "online")
        c.check("pagando por internet sí", isinstance(r, dict) and "id" in r, str(r)[:160])

        # El equipo queda fuera: quien levanta el pedido por teléfono cobra en
        # el mostrador, y esa decisión es del local.
        r = pedir_domicilio(duenyo, "cash")
        c.check("y el local sigue pudiendo cobrar a la puerta si lo levanta él",
                isinstance(r, dict) and "id" in r, str(r)[:160])

        sql(f"update public.restaurants set prepay_delivery = false where id = '{esc.restaurante}';")

        c.bloque("La limpieza no toca lo ajeno")
        sql("""
            -- Primero los secretos, mientras todavía se puede saber cuáles son
            -- suyos. Y sólo los suyos: barrer por el prefijo borraba también
            -- los de los locales de verdad y dejaba su ficha diciendo que
            -- tenían llaves cuando ya no existían.
            delete from vault.secrets where id in (
              select m.secret_id
                from public.merchant_payment_methods m
                join public.payment_providers p on p.id = m.provider_id
               where p.slug = 'mentira' and m.secret_id is not null
            );
            delete from public.payment_intents where provider_id in
              (select id from public.payment_providers where slug = 'mentira');
            delete from public.merchant_payment_methods where provider_id in
              (select id from public.payment_providers where slug = 'mentira');
            delete from public.payment_providers where slug = 'mentira';
        """)

        sigue = sql(f"select count(*)::int n from vault.secrets where id = '{ajeno}';")[0]["n"]
        c.check("el secreto de otro local sigue ahí", sigue == 1, f"quedan {sigue}")
        sql(f"delete from vault.secrets where id = '{ajeno}';")

        huerfanos = sql("""
            select count(*)::int n from public.merchant_payment_methods m
             where m.secret_id is not null
               and not exists (select 1 from vault.decrypted_secrets v where v.id = m.secret_id);
        """)[0]["n"]
        c.check("ninguna ficha apunta a llaves que ya no existen", huerfanos == 0,
                f"{huerfanos} fichas colgadas")


def aplicacion_en_marcha() -> bool:
    salida = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "5", f"{APP}/login"],
        capture_output=True, text=True).stdout
    return salida.strip() == "200"


def main() -> int:
    if not aplicacion_en_marcha():
        # Esta suite atraviesa la aplicación entera, así que necesita el
        # servidor levantado. Se avisa y se sale en vez de fallar, para que un
        # entorno sin servidor no enseñe a nadie a ignorar el rojo.
        print("\nCobrar con una pasarela que no existe")
        print(f"    saltada · no hay aplicación en {APP}")
        return 0

    c = Cuaderno("Cobrar con una pasarela que no existe")
    with Escenario() as esc:
        correr(c, esc)
    print(f"\n  {c.bien} bien · {c.mal} mal")
    return 1 if c.mal else 0


if __name__ == "__main__":
    sys.exit(main())
