-- =============================================================
--  Mercado Pago deja de sacar al cliente de la tienda
--
--  Su receta de la migración 0063 abre una preferencia de Checkout Pro y
--  devuelve una dirección: el cliente sale de Yumi, aterriza en una página de
--  Mercado Pago y allí le vuelven a preguntar con qué quiere pagar, que es lo
--  que ya había contestado aquí.
--
--  Esto declara lo otro que sabe hacer. La receta no se toca y sigue siendo el
--  camino de respaldo: si el guion del navegador no carga —una red mala, un
--  bloqueador— el botón de siempre sigue ahí.
--
--  `inline` es deliberadamente una declaración y no una implementación: dice
--  qué guion cargar, de qué campo sale la clave pública y qué formas de pago
--  ofrece. El cómo vive en el adaptador, en `src/lib/payments/proveedores/`,
--  porque cifrar una tarjeta en el navegador no se deja escribir como datos.
-- =============================================================

update public.payment_providers
   set inline = jsonb_build_object(
     -- Qué código nuestro lo atiende. El mismo nombre que el fichero del
     -- adaptador: buscarlo tiene que ser inmediato.
     'adapter', 'mercadopago',

     -- El guion de la pasarela, cargado desde su propio dominio. Tiene que ser
     -- el suyo: es lo que hace que el número de la tarjeta viaje de su
     -- navegador a ellos sin pasar por nosotros.
     'sdk', 'https://sdk.mercadopago.com/js/v2',

     -- De qué credencial sale la clave que el navegador puede ver. Va por
     -- nombre y no por posición para que añadir campos no lo rompa.
     'public_field', 'public_key',

     -- Qué sabe cobrar sin salir. `pse` está en la lista aunque acabe en la
     -- web del banco: lo que ocurre dentro es elegir banco y documento, que es
     -- justo la parte que antes pasaba en una página ajena.
     'methods', jsonb_build_array('card', 'pse'),

     -- En Colombia pagar a cuotas es lo normal y no ofrecerlo se nota.
     'installments', true,

     -- PSE sólo existe en Colombia. En el resto de países de Mercado Pago la
     -- pantalla enseña la tarjeta y nada más.
     'pse_countries', jsonb_build_array('CO')
   ),
       updated_at = now()
 where slug = 'mercadopago';
