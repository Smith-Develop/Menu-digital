-- Documento fiscal del restaurante.
--
-- El tipo va como texto libre y no como lista cerrada: cada país llama de una
-- forma a lo mismo (NIF, RUC, RFC, CUIT, NIT…) y una enumeración obligaría a
-- tocar la base cada vez que la plataforma entra en un país nuevo.
alter table public.restaurants
  add column if not exists document_type text,
  add column if not exists document_number text;

-- Dirección de entrega habitual del cliente.
--
-- Hasta ahora vivía sólo en la cookie de ubicación del navegador, así que se
-- perdía al cambiar de móvil y había que reescribirla en cada pedido. Guardarla
-- en el perfil la hace viajar con la cuenta.
alter table public.profiles
  add column if not exists address text,
  add column if not exists city text;
