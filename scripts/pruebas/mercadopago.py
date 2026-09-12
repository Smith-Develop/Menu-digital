#!/usr/bin/env python3
"""
Cobrar con Mercado Pago de verdad.

La pasarela de mentira demostró que el intérprete funciona. Ésta demuestra lo
que de verdad importaba: que funciona contra una pasarela real, con sus rarezas.

Y Mercado Pago tiene dos que ninguna receta previa contemplaba:

  - Su aviso no dice si el pago salió bien. Manda un identificador y hay que ir
    a buscar el estado. Por eso la receta tiene un paso `resolve`.
  - Su firma no es sobre el cuerpo, sino sobre un texto compuesto con trozos del
    cuerpo, de las cabeceras y de la propia firma.

Qué se prueba contra Mercado Pago de verdad: abrir el cobro. La llamada sale a
su API con las credenciales del comercio y vuelve con una dirección de pago
real.

Qué se prueba contra un doble: el aviso. Completar un pago necesita una tarjeta
de prueba, un comprador y una dirección pública a la que Mercado Pago pueda
avisar. Lo que sí se comprueba aquí, y es lo que puede estar mal en nuestro
lado, es que la firma se calcule exactamente como la documentan y que el estado
se vaya a buscar en lugar de creerse el mensaje.

Necesita las credenciales en el entorno:
    MP_ACCESS_TOKEN   el de la cuenta de pruebas
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
TOKEN = os.environ.get("MP_ACCESS_TOKEN", "")
# La clave pública es lo que enciende el cobro dentro de la aplicación: sin
# ella el navegador no puede cifrar la tarjeta y sólo queda redirigir.
CLAVE_PUBLICA = os.environ.get("MP_PUBLIC_KEY", "")
PUERTO = 8801

# Cuenta colombiana: pesos, y sin decimales, que es el camino donde se rompen
# los cálculos de importe si alguien da por hecho que todas las divisas tienen dos.
ESCENARIO = {"divisa": "COP", "decimales": 0, "pais": "CO"}
SECRETO = "secreto-de-avisos-de-mercadopago"

# El pago que devolvería Mercado Pago si se le preguntara por uno aprobado.
pago_falso: dict = {}


class DobleDeMercadoPago(BaseHTTPRequestHandler):
    """Contesta lo que contestaría `GET /v1/payments/{id}`."""

    def do_GET(self):  # noqa: N802
        cuerpo = json.dumps(pago_falso).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, *_):
        pass


def literal(valor) -> str:
    texto = valor if isinstance(valor, str) else json.dumps(valor)
    return "'" + texto.replace("'", "''") + "'"


def avisar(token: str, pago_id: str, secreto: str = SECRETO, request_id: str = "req-1"):
    """Manda el aviso firmado exactamente como lo firma Mercado Pago."""
    cuerpo = {"action": "payment.updated", "api_version": "v1",
              "data": {"id": pago_id}, "type": "payment", "live_mode": False}
    crudo = json.dumps(cuerpo)
    ts = "1757000000"

    # El texto firmado es un manifiesto, no el cuerpo. Así lo documentan.
    manifiesto = f"id:{pago_id};request-id:{request_id};ts:{ts};"
    v1 = hmac.new(secreto.encode(), manifiesto.encode(), hashlib.sha256).hexdigest()

    salida = subprocess.run([
        "curl", "-s", "-m", "30", "-w", "\n%{http_code}",
        f"{APP}/api/pago/aviso/{token}", "-X", "POST",
        "-H", "Content-Type: application/json",
        "-H", f"x-signature: ts={ts},v1={v1}",
        "-H", f"x-request-id: {request_id}",
        "-d", crudo,
    ], capture_output=True, text=True).stdout.strip().rsplit("\n", 1)

    return (json.loads(salida[0]) if salida[0].strip() else {}), int(salida[-1])


def correr(c: Cuaderno, esc: Escenario) -> None:
    duenyo = esc.tokens["owner"]

    servidor = HTTPServer(("127.0.0.1", PUERTO), DobleDeMercadoPago)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()

    try:
        # --- Alta -------------------------------------------------------
        c.bloque("La receta que se envía")

        # Se prueba la receta que trae la migración, no una copia suya escrita
        # aquí: una copia se queda vieja en cuanto alguien corrige la buena, y
        # entonces la prueba pasa mientras el producto falla.
        enviada = sql(
            "select spec, config_schema from public.payment_providers where slug = 'mercadopago';")
        if not c.check("Mercado Pago viene de serie en el catálogo", len(enviada) == 1,
                       "falta la migración 0063"):
            return

        receta = enviada[0]["spec"]
        c.check("su receta va a buscar el estado en vez de creerse el aviso",
                bool(receta.get("webhook", {}).get("resolve")), json.dumps(receta)[:200])
        c.check("y firma sobre el manifiesto, no sobre el cuerpo",
                "{{sig.ts}}" in receta["webhook"]["verify"].get("template", ""),
                json.dumps(receta["webhook"]["verify"])[:200])

        # Una copia sobre la que sí se puede sustituir el servidor de Mercado
        # Pago por un doble, sin tocar la fila que usan los comercios.
        sql(f"""
            delete from public.payment_providers where slug = 'mercadopago-prueba';
            insert into public.payment_providers (slug, name, kind, adapter, spec, config_schema)
            values ('mercadopago-prueba', 'Mercado Pago (prueba)', 'online', 'http',
                    {literal(receta)}::jsonb, {literal(enviada[0]["config_schema"])}::jsonb);
        """)
        proveedor = sql(
            "select id from public.payment_providers where slug='mercadopago-prueba';")[0]["id"]

        # El panel del comercio sólo ofrece lo que la plataforma haya puesto en
        # su país, así que la copia hay que ofrecerla también: comprobarlo es
        # parte de lo que se está probando.
        sql(f"""
            insert into public.country_payment_providers (country, provider_id)
            values ('{esc.pais}', '{proveedor}') on conflict do nothing;
        """)

        metodo = rest(duenyo, "merchant_payment_methods", "POST", {
            "restaurant_id": esc.restaurante, "provider_id": proveedor, "is_active": True})[0]
        rpc(duenyo, "save_merchant_credentials", {
            "p_method_id": metodo["id"],
            "p_credentials": {"access_token": TOKEN, "public_key": CLAVE_PUBLICA,
                              "webhook_secret": SECRETO}})
        c.check("el comercio la enciende y guarda su token", bool(metodo["id"]), "")

        # --- Cobro contra Mercado Pago de verdad ------------------------
        c.bloque("Abrir el cobro contra su API de verdad")
        pedido = rpc(esc.tokens["cliente"], "place_order", {
            "p_restaurant_slug": f"arnes-{esc.sufijo}",
            "p_items": [{"product_id": esc.productos["Plato caro"], "quantity": 1}],
            "p_type": "delivery", "p_payment_method": "card",
            "p_customer_name": "Comprador de prueba", "p_address": "Calle 1"})

        salida = subprocess.run([
            "curl", "-s", "-m", "45", f"{APP}/api/pago/iniciar", "-X", "POST",
            "-H", "Content-Type: application/json",
            "-d", json.dumps({"orderId": pedido["id"], "methodId": metodo["id"],
                              "token": pedido["token"]}),
        ], capture_output=True, text=True).stdout
        inicio = json.loads(salida) if salida.strip() else {}

        c.check("Mercado Pago devuelve una dirección de pago real",
                "mercadopago.com" in inicio.get("url", ""), str(inicio)[:250])

        intento = sql(f"""select id::text, status::text, provider_ref, amount_cents, currency
                            from public.payment_intents where order_id = '{pedido["id"]}';""")[0]
        c.check("con la referencia de su preferencia guardada",
                intento["status"] == "redirected" and "-" in (intento["provider_ref"] or ""),
                json.dumps(intento))
        c.check("y el importe en pesos, sin decimales",
                intento["currency"] == "COP" and intento["amount_cents"] == pedido["total_cents"],
                json.dumps(intento))

        # --- El aviso ----------------------------------------------------
        c.bloque("El aviso, con su firma y su consulta de vuelta")

        # Se sustituye sólo el servidor de Mercado Pago por un doble: la firma,
        # la plantilla del manifiesto y el resto del camino son los de verdad.
        sql(f"""
            update public.payment_providers
               set spec = jsonb_set(spec, '{{webhook,resolve,url}}',
                     '"http://127.0.0.1:{PUERTO}/v1/payments/{{{{body.data.id}}}}"'::jsonb)
             where slug = 'mercadopago-prueba';
        """)

        global pago_falso
        pago_falso = {
            "id": 123456789, "status": "approved",
            "external_reference": intento["id"],
            "transaction_amount": intento["amount_cents"],
            "currency_id": "COP",
            "fee_details": [{"type": "mercadopago_fee", "amount": 800}],
        }

        respuesta, codigo = avisar(metodo["webhook_token"], "123456789", secreto="otro")
        c.check("una firma que no cuadra se rechaza", codigo == 400, f"{codigo} · {respuesta}")

        respuesta, codigo = avisar(metodo["webhook_token"], "123456789")
        c.check("la firma del manifiesto se valida como la documentan",
                codigo == 200 and respuesta.get("recibido"), f"{codigo} · {respuesta}")

        o = rest(duenyo, f"orders?id=eq.{pedido['id']}&select=paid_cents,payment_status")[0]
        c.check("el pedido queda cobrado con lo que dijo la consulta, no el aviso",
                o["paid_cents"] == pedido["total_cents"] and o["payment_status"] == "paid",
                json.dumps(o))

        apunte = rest(duenyo, f"order_payments?order_id=eq.{pedido['id']}&select=*")[0]
        c.check("la comisión llega convertida a la unidad menor",
                apunte["fee_cents"] == 800, str(apunte.get("fee_cents")))
        c.check("y el apunte conserva la referencia de la preferencia",
                apunte["provider_ref"] == intento["provider_ref"], str(apunte.get("provider_ref")))

        respuesta, codigo = avisar(metodo["webhook_token"], "123456789")
        apuntes = rest(duenyo, f"order_payments?order_id=eq.{pedido['id']}&select=id")
        c.check("el aviso repetido no cobra dos veces", len(apuntes) == 1, f"{len(apuntes)} apuntes")

        # --- El panel del comercio ---------------------------------------
        # Se presta el local colombiano al navegador: en un local en euros la
        # pasarela no aparecería, y esa también es la respuesta correcta.
        c.bloque("El panel donde el comercio la enciende")
        entorno = {**os.environ,
                   "PANEL_EMAIL": esc.correos["owner"],
                   "PANEL_PASSWORD": "ArnesDePruebas123!",
                   "PANEL_SLUG": f"arnes-{esc.sufijo}",
                   # Quien paga no es el dueño: a domicilio la identificación es
                   # obligatoria, y sin sesión el formulario queda bloqueado.
                   "CLIENTE_EMAIL": esc.correos["cliente"],
                   "MP_PUBLIC_KEY": CLAVE_PUBLICA}
        salida = subprocess.run(
            ["node", str(Path(__file__).resolve().parent / "panel_cobro.mjs")],
            capture_output=True, text=True, env=entorno, timeout=240)

        for linea in salida.stdout.splitlines():
            if linea.startswith("__RESULTADO__"):
                bien, mal = (int(x) for x in linea.split()[1:3])
                c.bien += bien
                c.mal += mal
            elif linea.strip():
                print(linea)
        if "__RESULTADO__" not in salida.stdout:
            c.check("el panel responde", False, (salida.stderr or salida.stdout)[-220:])

    finally:
        servidor.shutdown()
        # La fila de verdad no se toca: sólo desaparece la copia de la prueba.
        sql("""
            -- Primero los secretos, mientras todavía se puede saber cuáles son
            -- suyos. Y sólo los suyos: barrer por el prefijo borraba también
            -- los de los locales de verdad y dejaba su ficha diciendo que
            -- tenían llaves cuando ya no existían.
            delete from vault.secrets where id in (
              select m.secret_id
                from public.merchant_payment_methods m
                join public.payment_providers p on p.id = m.provider_id
               where p.slug = 'mercadopago-prueba' and m.secret_id is not null
            );
            delete from public.payment_intents where provider_id in
              (select id from public.payment_providers where slug = 'mercadopago-prueba');
            delete from public.merchant_payment_methods where provider_id in
              (select id from public.payment_providers where slug = 'mercadopago-prueba');
            delete from public.payment_providers where slug = 'mercadopago-prueba';
        """)


def aplicacion_en_marcha() -> bool:
    if not TOKEN:
        return False
    salida = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "5", f"{APP}/login"],
        capture_output=True, text=True).stdout
    return salida.strip() == "200"


def main() -> int:
    if not TOKEN:
        print("\nCobrar con Mercado Pago de verdad")
        print("    saltada · falta MP_ACCESS_TOKEN en el entorno")
        return 0
    if not aplicacion_en_marcha():
        print("\nCobrar con Mercado Pago de verdad")
        print(f"    saltada · no hay aplicación en {APP}")
        return 0

    c = Cuaderno("Cobrar con Mercado Pago de verdad")
    with Escenario(**ESCENARIO) as esc:
        correr(c, esc)
    print(f"\n  {c.bien} bien · {c.mal} mal")
    return 1 if c.mal else 0


if __name__ == "__main__":
    sys.exit(main())
