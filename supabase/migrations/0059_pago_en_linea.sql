-- =============================================================
--  Bloque 1.1 · una forma de pago más
--
--  Hasta ahora las tres formas de pago describían algo que ocurría fuera del
--  programa: efectivo, tarjeta al recibir, datáfono. Las tres se anotaban
--  después. `online` es la primera que ocurre dentro, y por eso necesita nombre
--  propio: quién la cobró se guarda aparte, en el proveedor del apunte.
--
--  Va sola en su fichero porque un valor nuevo de enumeración no se puede usar
--  en la misma transacción en que se añade. La migración siguiente ya lo usa.
-- =============================================================

alter type payment_method add value if not exists 'online';
