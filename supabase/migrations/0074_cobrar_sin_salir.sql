-- =============================================================
--  Bloque 4 · pagar sin salir de la aplicación
--
--  Hasta ahora cobrar en línea era mandar al cliente a la página de la pasarela
--  y esperar a que volviera. Funciona, y es lo que hay que hacer cuando no
--  queda más remedio, pero tiene dos costes: el cliente sale de la tienda justo
--  en el momento más frágil de la compra, y allí se encuentra otra vez con la
--  pregunta de con qué quiere pagar, que ya había contestado aquí.
--
--  Esto pone los cimientos para que la tarjeta se meta dentro de la aplicación.
--  Los datos de la tarjeta no pasan por nuestro servidor en ningún momento: el
--  navegador se los da directamente a la pasarela, que devuelve un testigo de
--  un solo uso, y lo que nosotros mandamos es ese testigo. Por eso hace falta
--  guardar la clave pública del comercio donde el navegador pueda leerla, y por
--  eso no hay ni una columna donde pueda acabar un número de tarjeta.
--
--  Lo que no se puede meter dentro es PSE: acaba por diseño en la web del banco
--  del cliente. Lo que sí se queda dentro es elegir banco y volver.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · Una pasarela puede saber cobrar sin redirigir
--
-- El intérprete de recetas de la migración 0060 describe pasarelas que se
-- hablan por HTTP y devuelven una dirección. Cobrar dentro es otra cosa: hace
-- falta un guion en el navegador, que es código y no datos. Es el «enganche
-- compilado» que el plan previó en 1.2.e para Redsys y que aquí estrena
-- Mercado Pago.
--
-- Se añade sin tocar `spec`: la receta de redirección sigue ahí y sigue
-- valiendo. Una pasarela sin `inline` se comporta exactamente como hasta hoy.
-- ---------------------------------------------------------------
alter table public.payment_providers
  add column if not exists inline jsonb;

comment on column public.payment_providers.inline is
  'Cómo cobrar sin salir de la aplicación: qué guion carga el navegador y qué '
  'sabe hacer. Nulo significa que esta pasarela sólo cobra redirigiendo.';

-- ---------------------------------------------------------------
-- 2 · El comprador, visto por la pasarela del comercio
--
-- Cada comercio cobra con su propia cuenta, así que un cliente es un cliente
-- distinto en cada uno: una tarjeta guardada en La Trattoria no existe para el
-- supermercado de al lado. No es una limitación que se pueda programar por
-- encima —el dinero va directo a cada comercio, y ese es el modelo elegido—,
-- así que la tabla la refleja tal cual en su clave.
-- ---------------------------------------------------------------
create table if not exists public.payment_customers (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants(id) on delete cascade,
  provider_id          uuid not null references public.payment_providers(id) on delete cascade,
  user_id              uuid not null references public.profiles(id) on delete cascade,
  -- El identificador que le da la pasarela. No es nuestro y no significa nada
  -- fuera de la cuenta de ese comercio.
  provider_customer_id text not null,
  created_at           timestamptz not null default now(),
  unique (restaurant_id, provider_id, user_id)
);

/**
 * Las tarjetas que el cliente dejó guardadas.
 *
 * Aquí no hay ni puede haber un número de tarjeta. Lo que se guarda es el
 * identificador que la pasarela nos devuelve y lo justo para que el cliente
 * reconozca cuál es: la marca y las cuatro últimas cifras, que es exactamente
 * lo que enseña cualquier aplicación que hace esto bien.
 *
 * Cobrar con una de estas sigue exigiendo el código de seguridad, que no se
 * guarda en ninguna parte. Es lo que impide que quien se encuentre una sesión
 * abierta pueda gastar con la tarjeta de otro.
 */
create table if not exists public.payment_cards (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.payment_customers(id) on delete cascade,
  provider_card_id text not null,
  brand            text,
  last_four        text,
  exp_month        smallint,
  exp_year         smallint,
  holder_name      text,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (customer_id, provider_card_id),
  -- Cuatro cifras son cuatro cifras. La restricción está para que un error de
  -- programación no consiga meter aquí nada más largo.
  constraint payment_cards_solo_cuatro check (last_four is null or last_four ~ '^[0-9]{4}$')
);

create index if not exists payment_cards_cliente_idx
  on public.payment_cards (customer_id, created_at desc);

create unique index if not exists payment_cards_predeterminada_idx
  on public.payment_cards (customer_id) where is_default;

alter table public.payment_customers enable row level security;
alter table public.payment_customers force row level security;
alter table public.payment_cards     enable row level security;
alter table public.payment_cards     force row level security;

-- El comprador ve lo suyo. El comercio no ve ninguna: saber con qué tarjetas
-- paga su clientela no le hace falta para nada, y no tenerlo es una cosa menos
-- que puede filtrarse.
drop policy if exists payment_customers_propios on public.payment_customers;
create policy payment_customers_propios on public.payment_customers
  for select to authenticated using (user_id = auth.uid());

drop policy if exists payment_cards_propias on public.payment_cards;
create policy payment_cards_propias on public.payment_cards
  for select to authenticated
  using (exists (
    select 1 from public.payment_customers c
     where c.id = customer_id and c.user_id = auth.uid()
  ));

-- Borrar sí: es del cliente y tiene que poder quitarla. La baja en la pasarela
-- la hace el servidor después; si fallara, aquí ya no aparece y no se puede
-- volver a usar desde la aplicación.
drop policy if exists payment_cards_borrar on public.payment_cards;
create policy payment_cards_borrar on public.payment_cards
  for delete to authenticated
  using (exists (
    select 1 from public.payment_customers c
     where c.id = customer_id and c.user_id = auth.uid()
  ));

-- Escribir no. Una tarjeta aparece porque la pasarela dijo que existe, y eso
-- sólo lo sabe el servidor: nadie da de alta una tarjeta desde el navegador.
grant select on public.payment_customers to authenticated;
grant select, delete on public.payment_cards to authenticated;

-- ---------------------------------------------------------------
-- 3 · El comercio decide si a domicilio se paga antes
--
-- La auditoría dejó esta decisión pendiente antes del bloque 4 porque cambia el
-- flujo del pedido. Se resuelve como un interruptor del local y no como una
-- regla de la plataforma: en Colombia y en Honduras mucha gente paga en
-- efectivo en la puerta, y obligar a pagar por adelantado dejaría fuera a una
-- parte grande de la clientela de quien no lo necesita.
-- ---------------------------------------------------------------
alter table public.restaurants
  add column if not exists prepay_delivery boolean not null default false;

comment on column public.restaurants.prepay_delivery is
  'A domicilio sólo se acepta el pedido pagado por adelantado. Apagado, el '
  'cliente elige entre pagar ahora y pagar al recibir.';

-- ---------------------------------------------------------------
-- 4 · Lo que el escaparate necesita saber para pintar el formulario
--
-- Se añaden dos cosas a lo que ya devolvía: si esa pasarela sabe cobrar dentro,
-- y las credenciales **no secretas** del comercio.
--
-- Lo segundo suena peligroso y no lo es, siempre que se haga con cuidado: se
-- devuelven únicamente los campos que la receta marca como no secretos, que en
-- Mercado Pago es la clave pública. Una clave pública es pública por diseño —su
-- único trabajo es identificar al comercio ante el guion de la pasarela— y sin
-- ella el navegador no puede cifrar la tarjeta. El access token sigue donde
-- estaba, y de ahí no sale.
-- ---------------------------------------------------------------
create or replace function public.merchant_payment_options(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'method_id', m.id,
    'slug', p.slug,
    'name', coalesce(nullif(m.display_name, ''), p.name),
    'logo_url', p.logo_url,
    'kind', p.kind,
    'inline', p.inline,
    'public_config', (
      select coalesce(jsonb_object_agg(campo.nombre, campo.valor), '{}'::jsonb)
      from (
        select c->>'campo' as nombre,
               (v.decrypted_secret::jsonb) ->> (c->>'campo') as valor
        from jsonb_array_elements(coalesce(p.config_schema, '[]'::jsonb)) c
        -- Sin marca explícita de «no secreto», se considera secreto. Un campo
        -- nuevo que alguien olvide etiquetar no se publica por descuido.
        where coalesce((c->>'secreto')::boolean, true) = false
      ) campo
      where campo.valor is not null
    )
  ) order by m.position, p.name), '[]'::jsonb)
  from public.merchant_payment_methods m
  join public.payment_providers p on p.id = m.provider_id
  join vault.decrypted_secrets v on v.id = m.secret_id
  where m.restaurant_id = p_restaurant_id
    and m.is_active
    and p.is_active
    and p.kind = 'online'
    -- Encendido sin llaves que se puedan leer no es una forma de pago: es un
    -- botón que falla delante de un cliente.
    and coalesce(btrim(v.decrypted_secret), '') not in ('', '{}');
$$;

grant execute on function public.merchant_payment_options(uuid) to anon, authenticated;

-- ---------------------------------------------------------------
-- 5 · Las tarjetas guardadas de quien está pidiendo
--
-- Va por función y no por lectura directa de la tabla porque lo que hay que
-- preguntar es «mis tarjetas en este comercio», y eso son dos saltos que el
-- navegador no tiene por qué saber dar.
-- ---------------------------------------------------------------
create or replace function public.my_saved_cards(p_method_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'brand', t.brand,
    'last_four', t.last_four,
    'exp_month', t.exp_month,
    'exp_year', t.exp_year,
    'holder_name', t.holder_name,
    'is_default', t.is_default
  ) order by t.is_default desc, t.created_at desc), '[]'::jsonb)
  from public.payment_cards t
  join public.payment_customers c on c.id = t.customer_id
  join public.merchant_payment_methods m
    on m.restaurant_id = c.restaurant_id and m.provider_id = c.provider_id
  where m.id = p_method_id
    and c.user_id = auth.uid();
$$;

grant execute on function public.my_saved_cards(uuid) to authenticated;
