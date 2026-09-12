-- =============================================================
--  Devolver a Mercado Pago las etiquetas de sus campos
--
--  La migración 0063 la dio de alta con etiquetas legibles —«Access token»,
--  «Clave secreta de avisos»— y con la clave pública marcada como no secreta,
--  que es lo que es. La pantalla de pasarelas del superadministrador guardaba
--  sólo el nombre del campo y marcaba todo como secreto, así que abrirla y
--  pulsar guardar le borraba las etiquetas sin decir nada.
--
--  La pantalla ya no lo hace. Esto repara lo que se perdió mientras tanto.
-- =============================================================

update public.payment_providers
   set config_schema = '[
         {"campo":"access_token","etiqueta":"Access token","secreto":true},
         {"campo":"public_key","etiqueta":"Public key","secreto":false},
         {"campo":"webhook_secret","etiqueta":"Clave secreta de avisos","secreto":true}
       ]'::jsonb,
       updated_at = now()
 where slug = 'mercadopago';
