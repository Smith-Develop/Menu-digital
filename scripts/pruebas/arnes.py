#!/usr/bin/env python3
"""
Arnés de pruebas: un local propio, sesiones reales y limpieza garantizada.

Hasta ahora cada verificación se hacía con un guion escrito para la ocasión y
borrado después, y sobre los datos reales de La Trattoria. Funcionaba mientras
alguien se acordaba de restaurar el estado a mano.

Aquí las pruebas montan **su propio local** —con su equipo, su carta, su
repartidor y su suscripción viva— y lo desmontan al terminar. No tocan ningún
dato de verdad, así que se pueden ejecutar cuantas veces haga falta y sin mirar.

Las sesiones son de verdad: se entra por la API de autenticación con el correo y
la contraseña de cada rol, y las llamadas van por PostgREST. Es la única forma de
probar lo que importa, que son las políticas y las comprobaciones de permiso.
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
from migrate import consulta as sql  # noqa: E402  (misma conexión que el ejecutor)

CLAVE = "ArnesDePruebas123!"
MARCA = "_arnes"


def _entorno() -> dict[str, str]:
    valores = {}
    for linea in (RAIZ / ".env.local").read_text().splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            clave, valor = linea.split("=", 1)
            valores[clave.strip()] = valor.strip()
    return valores


ENV = _entorno()
API = ENV["NEXT_PUBLIC_SUPABASE_URL"]
ANON = ENV["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
SERVICIO = ENV.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _curl(args: list[str]) -> str:
    return subprocess.run(["curl", "-s", "-m", "45"] + args, capture_output=True, text=True).stdout


def _json(salida: str):
    try:
        return json.loads(salida) if salida.strip() else []
    except json.JSONDecodeError:
        return {"crudo": salida[:400]}


# --------------------------------------------------------------------------
# Sesiones y llamadas
# --------------------------------------------------------------------------
def entrar(email: str, clave: str = CLAVE) -> str:
    respuesta = _json(_curl([
        f"{API}/auth/v1/token?grant_type=password",
        "-H", f"apikey: {ANON}", "-H", "Content-Type: application/json",
        "-d", json.dumps({"email": email, "password": clave}),
    ]))
    if not isinstance(respuesta, dict) or "access_token" not in respuesta:
        raise RuntimeError(f"no se pudo entrar como {email}: {json.dumps(respuesta)[:200]}")
    return respuesta["access_token"]


def rest(token: str | None, ruta: str, metodo: str = "GET", cuerpo=None):
    """Llamada a PostgREST. Sin token va como anónimo, que es una prueba en sí."""
    args = [f"{API}/rest/v1/{ruta}", "-H", f"apikey: {ANON}", "-X", metodo,
            "-H", "Content-Type: application/json", "-H", "Prefer: return=representation"]
    if token:
        args += ["-H", f"Authorization: Bearer {token}"]
    if cuerpo is not None:
        args += ["-d", json.dumps(cuerpo)]
    return _json(_curl(args))


def rpc(token: str | None, funcion: str, argumentos: dict):
    return rest(token, f"rpc/{funcion}", "POST", argumentos)


def error_de(respuesta) -> str:
    """El código de error de PostgREST, sin el detalle que sigue a los dos puntos."""
    if isinstance(respuesta, dict):
        mensaje = respuesta.get("message") or ""
        return mensaje.split(":")[0] if mensaje else ""
    return ""


# --------------------------------------------------------------------------
# Cuenta de resultados
# --------------------------------------------------------------------------
class Cuaderno:
    def __init__(self, titulo: str):
        self.titulo = titulo
        self.bien = 0
        self.mal = 0
        print(f"\n{titulo}")

    def bloque(self, nombre: str) -> None:
        print(f"\n  {nombre}")

    def check(self, nombre: str, condicion: bool, detalle: str = "") -> bool:
        if condicion:
            self.bien += 1
            print(f"    ok    {nombre}")
        else:
            self.mal += 1
            print(f"    FALLO {nombre}" + (f"  ::  {detalle[:220]}" if detalle else ""))
        return condicion


# --------------------------------------------------------------------------
# El local de pruebas
# --------------------------------------------------------------------------
class Escenario:
    """
    Monta un local completo y lo desmonta al salir.

    Se usa como contexto para que la limpieza ocurra también cuando una prueba
    revienta a mitad: un escenario que sobrevive a un fallo contamina las
    ejecuciones siguientes y hace perder más tiempo del que ahorra.
    """

    def __init__(self):
        self.sufijo = uuid.uuid4().hex[:8]
        self.usuarios: dict[str, str] = {}      # rol -> id
        self.correos: dict[str, str] = {}       # rol -> correo
        self.tokens: dict[str, str] = {}        # rol -> token
        self.restaurante: str = ""
        self.productos: dict[str, str] = {}     # nombre -> id
        self.repartidor: str = ""

    # -- alta -------------------------------------------------------------
    def _crear_usuario(self, rol: str) -> str:
        correo = f"{MARCA}_{rol}_{self.sufijo}@yumi.test"
        respuesta = _json(_curl([
            f"{API}/auth/v1/admin/users",
            "-H", f"apikey: {SERVICIO}", "-H", f"Authorization: Bearer {SERVICIO}",
            "-H", "Content-Type: application/json", "-X", "POST",
            "-d", json.dumps({"email": correo, "password": CLAVE, "email_confirm": True}),
        ]))
        if not isinstance(respuesta, dict) or "id" not in respuesta:
            raise RuntimeError(f"no se pudo crear {correo}: {json.dumps(respuesta)[:200]}")
        self.correos[rol] = correo
        return respuesta["id"]

    def __enter__(self) -> "Escenario":
        try:
            return self._montar()
        except Exception:
            self.desmontar()
            raise

    def _montar(self) -> "Escenario":
        for rol in ("owner", "cajero", "cocina", "repartidor", "cliente"):
            self.usuarios[rol] = self._crear_usuario(rol)

        # El perfil lo crea un disparador al dar de alta el usuario; si no
        # existiera, las políticas de equipo no encontrarían a nadie.
        faltan = sql(f"""
            select count(*)::int as n from (values {','.join(f"('{i}'::uuid)" for i in self.usuarios.values())})
              as v(id) where not exists (select 1 from public.profiles p where p.id = v.id);
        """)[0]["n"]
        if faltan:
            raise RuntimeError(f"{faltan} usuarios sin perfil: falta el disparador de alta")

        datos = sql(f"""
            insert into public.restaurants (
              owner_id, slug, name, description, city, country, currency,
              currency_decimals, timezone, is_active, is_open,
              delivery_enabled, pickup_enabled, dinein_enabled,
              accepts_cash, accepts_card, accepts_tpv,
              delivery_fee_cents, min_order_cents, tax_rate
            ) values (
              '{self.usuarios["owner"]}', 'arnes-{self.sufijo}', 'Local del arnés',
              'Existe sólo para las pruebas', 'Madrid', 'ES', 'EUR',
              2, 'Europe/Madrid', true, true,
              true, true, true, true, true, true,
              300, 0, 0.10
            ) returning id;
        """)
        self.restaurante = datos[0]["id"]

        # Equipo y suscripción viva: sin ella el local no acepta pedidos.
        sql(f"""
            insert into public.restaurant_staff (restaurant_id, user_id, role, is_active) values
              ('{self.restaurante}', '{self.usuarios["owner"]}',  'owner',   true),
              ('{self.restaurante}', '{self.usuarios["cajero"]}', 'cashier', true),
              ('{self.restaurante}', '{self.usuarios["cocina"]}', 'kitchen', true);

            insert into public.subscriptions (subject_type, subject_id, restaurant_id, plan_id, status,
                                              current_period_start, current_period_end)
            select 'restaurant', '{self.restaurante}', '{self.restaurante}', p.id, 'active',
                   now(), now() + interval '90 days'
              from public.plans p where p.is_active order by p.price_cents desc limit 1;

            insert into public.couriers (user_id, city, is_active)
            values ('{self.usuarios["repartidor"]}', 'Madrid', true);
        """)
        self.repartidor = sql(
            f"select id from public.couriers where user_id = '{self.usuarios['repartidor']}';"
        )[0]["id"]
        sql(f"""
            insert into public.restaurant_couriers (restaurant_id, courier_id, is_active)
            values ('{self.restaurante}', '{self.repartidor}', true);
        """)

        for nombre, precio in (("Plato caro", 2000), ("Plato barato", 500), ("Bebida", 250)):
            fila = sql(f"""
                insert into public.products (restaurant_id, catalog_category_id, name, price_cents,
                                             is_available, tax_rate)
                select '{self.restaurante}', c.id, '{nombre}', {precio}, true, 0.10
                  from public.catalog_categories c where c.is_active order by c.position limit 1
                returning id;
            """)
            self.productos[nombre] = fila[0]["id"]

        for rol in ("owner", "cajero", "cocina", "repartidor", "cliente"):
            self.tokens[rol] = entrar(self.correos[rol])

        return self

    # -- baja -------------------------------------------------------------
    def __exit__(self, *_) -> None:
        self.desmontar()

    def desmontar(self) -> None:
        """
        Borra el escenario entero y comprueba que no queda nada.

        El restaurante arrastra en cascada veintidós tablas, pero no todas: los
        documentos fiscales bloquean el borrado del pedido a propósito —una
        factura emitida no desaparece— y hay dos referencias que se quedan a
        nulo en vez de irse. Se limpian a mano antes.
        """
        if self.restaurante:
            self._borrar_local()
        self._borrar_usuarios()

    def _borrar_local(self) -> None:
        sql(f"""
            delete from public.fiscal_documents where restaurant_id = '{self.restaurante}';
            delete from public.platform_commissions
             where subject_type = 'restaurant' and subject_id = '{self.restaurante}';
            delete from public.coupon_redemptions where restaurant_id = '{self.restaurante}';
            delete from public.money_audit where restaurant_id = '{self.restaurante}';
            delete from public.restaurants where id = '{self.restaurante}';
        """)

    def _borrar_usuarios(self) -> None:
        for identificador in self.usuarios.values():
            _curl([f"{API}/auth/v1/admin/users/{identificador}",
                   "-H", f"apikey: {SERVICIO}", "-H", f"Authorization: Bearer {SERVICIO}",
                   "-X", "DELETE"])

        resto = sql(f"""
            select (select count(*) from public.restaurants where slug = 'arnes-{self.sufijo}') as locales,
                   (select count(*) from public.profiles
                     where email like '{MARCA}\\_%\\_{self.sufijo}@yumi.test') as perfiles;
        """)[0]
        if any(resto.values()):
            print(f"  AVISO: el escenario dejó restos: {json.dumps(resto)}")


def limpiar_huerfanos() -> int:
    """
    Barre escenarios de ejecuciones que se cortaron a mitad.

    Se llama al empezar y no al terminar: si una tanda anterior murió por un
    corte de red —o por un fallo en el propio montaje, que fue lo que pasó la
    primera vez— sus restos siguen ahí, y conviene quitarlos antes de medir.

    Barre las dos mitades. El local se lleva por delante casi todo en cascada,
    pero los usuarios viven en el esquema de autenticación y sobreviven al
    borrado del restaurante: son los que quedaron sueltos cuando el montaje
    reventó antes de llegar a crearlo.
    """
    borrados = sql("""
        with locales as (
          delete from public.restaurants where slug like 'arnes-%' returning 1
        ), usuarios as (
          -- El dominio entero es de pruebas: `.test` está reservado justo para
          -- esto y ninguna cuenta de verdad puede terminar ahí.
          delete from auth.users where email like '%@yumi.test' returning 1
        )
        select (select count(*) from locales) + (select count(*) from usuarios) as n;
    """)[0]["n"]
    return borrados
