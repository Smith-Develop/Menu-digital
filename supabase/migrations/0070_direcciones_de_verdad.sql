-- =============================================================
--  Una ciudad no es una dirección
--
--  El checkout enseñaba «Usando tu dirección guardada: Dabeiba» y mandaba eso
--  mismo al repartidor. No era un fallo, eran cuatro encadenados:
--
--    1. La dirección salía de la cookie de ubicación, donde es opcional:
--       el cliente elige ciudad y se va.
--    2. El checkout la componía como «dirección, ciudad», y sin dirección
--       quedaba sólo la ciudad.
--    3. Como el resultado no estaba vacío, daba la dirección por buena y
--       escondía el campo: nunca se le llegaba a preguntar.
--    4. `place_order` sólo exigía que no viniera vacía, así que la aceptaba.
--
--  Y `profiles.address`, que sí existe y el formulario de perfil guarda, no la
--  leía nadie al pedir.
--
--  Aquí la dirección deja de ser una línea de texto suelta y pasa a ser lo que
--  es: una ficha con calle, barrio, detalles y referencias, que el cliente
--  guarda una vez y reutiliza. Y la base deja de aceptar el nombre de una
--  ciudad como dirección de entrega, que es la comprobación que faltaba.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · La libreta de direcciones del cliente
--
-- Una persona tiene casa y trabajo, y pide a las dos. Guardar una sola en el
-- perfil obligaba a reescribirla cada vez que cambiaba de sitio.
--
-- Cuelga del cliente y no del pedido porque a domicilio siempre hay cuenta: la
-- identificación es obligatoria salvo en mesa. Los pedidos que levanta el
-- comercio por teléfono siguen por el camino de texto libre, que se conserva
-- más abajo.
-- ---------------------------------------------------------------
create table if not exists public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- Cómo la llama el cliente: "Casa", "Trabajo", "Casa de mi madre".
  label        text,
  country      text references public.platform_countries(code),
  city         text not null,
  -- En Colombia y en Honduras el barrio o la colonia son media dirección; en
  -- España sobra. Por eso es opcional y no obligatorio.
  neighborhood text,
  -- La línea principal: "Cra 45 # 12-34", "Calle Mayor 8".
  street       text not null,
  -- Piso, apartamento, torre, bloque.
  details      text,
  -- Lo que el repartidor necesita para encontrar el portal: "portón verde",
  -- "frente al parque", "timbre que no suena, llamar al móvil".
  notes        text,
  lat          double precision,
  lng          double precision,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Las dos reglas que impiden que vuelva a pasar lo de "Dabeiba".
  constraint customer_addresses_calle_con_contenido
    check (length(btrim(street)) >= 5),
  constraint customer_addresses_calle_no_es_la_ciudad
    check (lower(btrim(street)) is distinct from lower(btrim(city)))
);

comment on table public.customer_addresses is
  'Direcciones de entrega guardadas por el cliente. Una ciudad no es una dirección.';

/**
 * La dirección en una línea, tal y como se imprime y se le enseña al
 * repartidor.
 *
 * Es columna generada y no una función para que no dependa de ningún permiso:
 * las migraciones 0064 y 0065 enseñaron que la expresión de una columna
 * generada la evalúa quien escribe la fila, y una llamada a función ahí dentro
 * es una trampa que sólo salta en producción.
 */
alter table public.customer_addresses
  add column if not exists full_line text generated always as (
    btrim(street)
    || coalesce(', ' || nullif(btrim(details), ''), '')
    || coalesce(', ' || nullif(btrim(neighborhood), ''), '')
    || ', ' || btrim(city)
  ) stored;

-- Una sola predeterminada por cliente. El índice parcial lo garantiza sin
-- necesidad de un disparador que apague las demás a mano.
create unique index if not exists customer_addresses_predeterminada_idx
  on public.customer_addresses (user_id) where is_default;

create index if not exists customer_addresses_cliente_idx
  on public.customer_addresses (user_id, created_at desc);

drop trigger if exists customer_addresses_touch on public.customer_addresses;
create trigger customer_addresses_touch
  before update on public.customer_addresses
  for each row execute function public.touch_updated_at();

alter table public.customer_addresses enable row level security;
alter table public.customer_addresses force row level security;

-- Cada uno ve y toca las suyas, y nadie más. Ni siquiera el comercio: lo que
-- el comercio necesita saber viaja en el pedido, no en la libreta.
drop policy if exists customer_addresses_propias on public.customer_addresses;
create policy customer_addresses_propias on public.customer_addresses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.customer_addresses to authenticated;

-- ---------------------------------------------------------------
-- 2 · El pedido guarda la dirección que tenía entonces
--
-- La ficha se puede editar o borrar después, y un pedido de hace tres meses
-- tiene que seguir diciendo a dónde se llevó. Por eso hay las dos cosas: el
-- vínculo, para saber cuál fue, y la copia, para que no cambie debajo.
-- ---------------------------------------------------------------
alter table public.orders
  add column if not exists address_id uuid
    references public.customer_addresses(id) on delete set null,
  add column if not exists address_snapshot jsonb;

comment on column public.orders.address_snapshot is
  'La dirección tal y como estaba al pedir. La ficha puede cambiar; esto no.';

create index if not exists orders_direccion_idx
  on public.orders (address_id) where address_id is not null;

-- ---------------------------------------------------------------
-- 3 · Lo que ya había guardado, a la libreta
--
-- `profiles.address` era texto libre y muchas filas son el nombre de una
-- ciudad, que es justo lo que esta migración deja de aceptar. Se traen sólo
-- las que parecen una dirección de verdad; el resto se le volverá a preguntar
-- al cliente la próxima vez que pida, que es lo correcto.
-- ---------------------------------------------------------------
insert into public.customer_addresses (user_id, label, city, street, is_default)
select p.id,
       'Casa',
       coalesce(nullif(btrim(p.city), ''), 'Sin ciudad'),
       btrim(p.address),
       true
from public.profiles p
where coalesce(btrim(p.address), '') <> ''
  and length(btrim(p.address)) >= 5
  and lower(btrim(p.address)) is distinct from lower(btrim(coalesce(p.city, '')))
  -- Y que no sea el nombre de una ciudad de la plataforma, que es la forma
  -- exacta en que se coló el fallo.
  and not exists (
    select 1 from public.platform_cities c
    where lower(public.unaccent_fallback(c.name))
        = lower(public.unaccent_fallback(btrim(p.address)))
  )
  and not exists (
    select 1 from public.customer_addresses a where a.user_id = p.id
  );

-- ---------------------------------------------------------------
-- 4 · ¿Esto es una dirección o es una ciudad?
--
-- La comprobación vive en la base y no en el formulario porque el formulario
-- no es el único camino: quedan el TPV, la API y cualquier importación.
-- ---------------------------------------------------------------
create or replace function public.address_looks_complete(p_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(btrim(p_text), '') <> ''
     and length(btrim(p_text)) >= 5
     -- El nombre pelado de una ciudad de la plataforma no es una dirección.
     -- Se compara sin tildes y sin mayúsculas porque quien lo teclea no las
     -- pone igual que quien dio de alta la ciudad.
     and not exists (
       select 1 from public.platform_cities c
       where lower(public.unaccent_fallback(c.name))
           = lower(public.unaccent_fallback(btrim(p_text)))
     );
$$;

grant execute on function public.address_looks_complete(text) to anon, authenticated;
