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
from arnes import Cuaderno, Escenario, rest, rpc, sql  # noqa: E402

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
            "amount": "{{amount_major}}",
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

    # --- La pasarela de mentira, en marcha ------------------------------
    servidor = HTTPServer(("127.0.0.1", PUERTO), Pasarela)
    hilo = threading.Thread(target=servidor.serve_forever, daemon=True)
    hilo.start()

    try:
        # --- Alta, sólo con datos ---------------------------------------
        c.bloque("Dar de alta una pasarela sin tocar código")
        sql(f"""
            delete from public.payment_providers where slug = 'mentira';
            insert into public.payment_providers (slug, name, kind, adapter, spec, config_schema)
            values ('mentira', 'Pasarela de mentira', 'online', 'http',
                    {literal(RECETA)}::jsonb,
                    '[{{"campo":"secret_key","secreto":true}},
                      {{"campo":"webhook_secret","secreto":true}}]'::jsonb);
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
            "p_credentials": {"secret_key": LLAVE, "webhook_secret": SECRETO_AVISO},
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

        # --- El cobro ----------------------------------------------------
        c.bloque("Cobrar de punta a punta")
        pedido = rpc(esc.tokens["cliente"], "place_order", {
            "p_restaurant_slug": f"arnes-{esc.sufijo}",
            "p_items": [{"product_id": esc.productos["Plato caro"], "quantity": 1}],
            "p_type": "delivery", "p_payment_method": "card",
            "p_customer_name": "Quien paga", "p_address": "Calle 1"})
        total = pedido["total_cents"]

        salida = subprocess.run([
            "curl", "-s", "-m", "40", f"{APP}/api/pago/iniciar",
            "-X", "POST", "-H", "Content-Type: application/json",
            "-d", json.dumps({"orderId": pedido["id"], "methodId": metodo_id,
                              "token": pedido["token"]}),
        ], capture_output=True, text=True).stdout
        inicio = json.loads(salida) if salida.strip() else {}
        c.check("la aplicación abre el cobro y devuelve a dónde ir",
                inicio.get("url", "").endswith("REF-DE-MENTIRA-1"), str(inicio)[:250])

        c.check("la pasarela recibió el importe en sus dos formatos",
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
        sql("""
            delete from public.payment_intents where provider_id in
              (select id from public.payment_providers where slug = 'mentira');
            delete from public.merchant_payment_methods where provider_id in
              (select id from public.payment_providers where slug = 'mentira');
            delete from public.payment_providers where slug = 'mentira';
            delete from vault.secrets where name like 'pago_%';
        """)


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
