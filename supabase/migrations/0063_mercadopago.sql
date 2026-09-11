-- =============================================================
--  Bloque 2.1 · Mercado Pago, de serie
--
--  La primera pasarela de verdad. Se elige ésta y no Stripe a propósito: Stripe
--  es la más cómoda y por eso enseña menos. Mercado Pago trae dos rarezas que
--  ninguna receta anterior contemplaba, y encontrarlas ahora —con una sola
--  pasarela conectada— es mucho más barato que encontrarlas con cuatro.
--
--  La primera: su aviso no dice si el pago salió bien. Manda un identificador y
--  hay que ir a preguntar. De ahí el paso `resolve` de la receta, que además es
--  más seguro: el estado llega por un canal autenticado en vez de venir dentro
--  de un mensaje que cualquiera puede intentar falsificar.
--
--  La segunda: su firma no es sobre el cuerpo del aviso sino sobre un texto
--  compuesto —`id:…;request-id:…;ts:…;`— con trozos del cuerpo, de las
--  cabeceras y de la propia firma. De ahí las plantillas `{{body.…}}`,
--  `{{header.…}}` y `{{sig.…}}`.
--
--  Lo que cada comercio pone es su token y el secreto de avisos de su panel de
--  Mercado Pago. La receta no lleva ninguna credencial: son marcas.
--
--  Nota para cuando toque: si con credenciales de prueba hiciera falta la
--  dirección de sandbox, es cambiar `$.init_point` por `$.sandbox_init_point`
--  en el formulario. No hay que desplegar nada, que es el sentido de todo esto.
-- =============================================================

insert into public.payment_providers
  (slug, name, kind, adapter, countries, currencies, spec, config_schema, position)
values (
  'mercadopago', 'Mercado Pago', 'online', 'http',
  '{CO,AR,MX,BR,CL,PE,UY}',
  '{COP,ARS,MXN,BRL,CLP,PEN,UYU}',
  '{
  "auth": {
    "mode": "bearer",
    "token": "{{access_token}}"
  },
  "encoding": "json",
  "create": {
    "method": "POST",
    "url": "https://api.mercadopago.com/checkout/preferences",
    "body": {
      "items": [
        {
          "title": "{{description}}",
          "quantity": 1,
          "unit_price": "{{amount_major}}",
          "currency_id": "{{currency}}"
        }
      ],
      "external_reference": "{{intent_id}}",
      "notification_url": "{{webhook_url}}",
      "back_urls": {
        "success": "{{return_url}}",
        "failure": "{{cancel_url}}",
        "pending": "{{return_url}}"
      }
    },
    "extract": {
      "redirect_url": "$.init_point",
      "reference": "$.id"
    }
  },
  "webhook": {
    "verify": {
      "mode": "hmac_sha256",
      "header": "x-signature",
      "parts": {
        "separator": ",",
        "signature": "v1"
      },
      "secret": "{{webhook_secret}}",
      "encoding": "hex",
      "template": "id:{{body.data.id}};request-id:{{header.x-request-id}};ts:{{sig.ts}};"
    },
    "resolve": {
      "method": "GET",
      "url": "https://api.mercadopago.com/v1/payments/{{body.data.id}}"
    },
    "reference": "$.external_reference",
    "reference_is": "intent_id",
    "status": "$.status",
    "map": {
      "approved": "paid",
      "rejected": "failed",
      "cancelled": "cancelled",
      "charged_back": "failed"
    },
    "fee": "$.fee_details[0].amount",
    "fee_is_major": true
  }
}'::jsonb,
  '[{"campo":"access_token","etiqueta":"Access token","secreto":true},
    {"campo":"public_key","etiqueta":"Public key","secreto":false},
    {"campo":"webhook_secret","etiqueta":"Clave secreta de avisos","secreto":true}]'::jsonb,
  10
)
on conflict (slug) do update set
  spec = excluded.spec,
  config_schema = excluded.config_schema,
  countries = excluded.countries,
  currencies = excluded.currencies,
  updated_at = now();
