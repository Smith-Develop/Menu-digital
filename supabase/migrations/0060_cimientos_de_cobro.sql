-- =============================================================
--  Bloque 1.1 · las tres tablas del cobro en línea
--
--  La idea es que una pasarela REST moderna hace casi siempre lo mismo: te
--  autenticas, le mandas un importe, te devuelve una dirección a la que enviar
--  al cliente, y más tarde te avisa por un webhook firmado. Lo único que cambia
--  entre una y otra son los nombres de los campos, la dirección y cómo se firma.
--  Todo eso se puede escribir como datos, y entonces dar de alta una pasarela
--  deja de ser programar y pasa a ser rellenar un formulario.
--
--  Aquí está la parte que guarda esos datos. El intérprete que los ejecuta va
--  en la aplicación, no en la base: hacer llamadas HTTP desde dentro de una
--  transacción es una forma conocida de dejar la base bloqueada esperando a un
--  servidor ajeno que no contesta.
--
--  Tres tablas y una regla que las sostiene:
--
--    payment_providers        lo que se puede conectar, y su receta
--    merchant_payment_methods lo que ha encendido cada comercio, con su llave
--    payment_intents          cada cobro en vuelo
--
--  La regla es la idempotencia. Los webhooks se repiten, llegan tarde y llegan
--  desordenados; sin un índice único sobre proveedor y referencia, el mismo
--  cobro se apunta dos veces y la caja del turno deja de cuadrar.
-- =============================================================

do $$ begin
  create type payment_provider_kind as enum ('online', 'terminal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_intent_status as enum
    ('pending', 'redirected', 'paid', 'failed', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 1 · El catálogo de lo conectable
-- ---------------------------------------------------------------
create table if not exists public.payment_providers (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  logo_url    text,
  kind        payment_provider_kind not null default 'online',

  -- Dónde vale. Vacío quiere decir «en todas partes», que es lo que hay que
  -- poder decir de PayPal sin enumerar el mundo.
  countries   text[] not null default '{}',
  currencies  text[] not null default '{}',

  /*
   * Qué motor la ejecuta.
   *
   * `http` significa que la receta de abajo basta. Cualquier otro valor nombra
   * un adaptador compilado, para las que no se dejan describir: Redsys firma
   * cada operación con una clave derivada por 3DES y eso no es un dato, es
   * código. El enganche existe desde el principio para que añadirlas no obligue
   * a rediseñar nada.
   */
  adapter     text not null default 'http',

  -- Qué credenciales pedirle al comercio. Lo consume el formulario del panel:
  -- [{"campo":"secret_key","etiqueta":"Clave secreta","secreto":true}, …]
  config_schema jsonb not null default '[]'::jsonb,

  -- La receta. Autenticación, qué enviar, dónde leer la respuesta, cómo
  -- verificar el aviso y a qué estado nuestro corresponde cada estado suyo.
  spec        jsonb not null default '{}'::jsonb,

  is_active   boolean not null default true,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists payment_providers_activos_idx
  on public.payment_providers (is_active, position);

-- ---------------------------------------------------------------
-- 2 · Lo que ha encendido cada comercio
-- ---------------------------------------------------------------
create table if not exists public.merchant_payment_methods (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  provider_id   uuid not null references public.payment_providers(id) on delete restrict,

  display_name  text,
  position      integer not null default 0,
  is_active     boolean not null default false,

  -- Lo que no es secreto: número de comercio, entorno de pruebas o real, y
  -- cualquier ajuste que la receta necesite y no sea una llave.
  settings      jsonb not null default '{}'::jsonb,

  /*
   * Las credenciales no viven aquí.
   *
   * Se guardan cifradas en Vault y esta columna sólo tiene el identificador del
   * secreto, que sin acceso a Vault no sirve de nada. Así el equipo del local
   * puede leer su propia fila —la necesita para saber qué tiene encendido— sin
   * poder leer su clave secreta desde el navegador.
   */
  secret_id     uuid,

  /*
   * Por dónde entra el aviso de esta pasarela para este comercio.
   *
   * Cada proveedor manda todos sus avisos a la misma dirección, así que sin
   * esto habría que adivinar de qué comercio es cada uno probando firmas hasta
   * acertar. Con un trozo de dirección propio por método, el aviso llega ya
   * identificado y sólo hay que verificar una firma.
   */
  webhook_token text not null unique default replace(gen_random_uuid()::text, '-', ''),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (restaurant_id, provider_id)
);

create index if not exists merchant_methods_restaurante_idx
  on public.merchant_payment_methods (restaurant_id, position)
  where is_active;

-- ---------------------------------------------------------------
-- 3 · Cada cobro en vuelo
-- ---------------------------------------------------------------
create table if not exists public.payment_intents (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  method_id     uuid references public.merchant_payment_methods(id) on delete set null,
  provider_id   uuid references public.payment_providers(id) on delete set null,

  amount_cents  integer not null check (amount_cents > 0),
  currency      char(3) not null,

  status        payment_intent_status not null default 'pending',
  -- Cómo se llama esta operación en el proveedor. Es la mitad de la clave que
  -- impide cobrar dos veces.
  provider_ref  text,
  redirect_url  text,

  -- La última respuesta, tal cual vino. Cuando algo no cuadre, esto es lo que
  -- se le enseña al proveedor para discutirlo.
  raw           jsonb,
  error_code    text,

  expires_at    timestamptz not null default now() + interval '30 minutes',
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists payment_intents_pedido_idx on public.payment_intents (order_id, created_at desc);
create index if not exists payment_intents_vivos_idx
  on public.payment_intents (status, expires_at) where status in ('pending', 'redirected');
create unique index if not exists payment_intents_ref_idx
  on public.payment_intents (provider_id, provider_ref) where provider_ref is not null;

-- ---------------------------------------------------------------
-- 4 · El libro de cobros aprende de dónde vino el dinero
-- ---------------------------------------------------------------
alter table public.order_payments
  add column if not exists provider_id  uuid references public.payment_providers(id) on delete set null,
  add column if not exists provider_ref text,
  -- Lo que se queda la pasarela. Cobrar 20 € no es ingresar 20 €, y el local
  -- tiene derecho a ver la diferencia sin ir a mirar a otro sitio.
  add column if not exists fee_cents    integer not null default 0,
  add column if not exists raw          jsonb;

/*
 * La línea que impide cobrar dos veces.
 *
 * Un webhook repetido trae la misma referencia del proveedor. Con este índice,
 * el segundo intento de apuntarlo choca contra la base en lugar de sumar otro
 * cobro al pedido y descuadrar el arqueo del turno.
 */
create unique index if not exists order_payments_referencia_idx
  on public.order_payments (provider_id, provider_ref)
  where provider_ref is not null;

-- ---------------------------------------------------------------
-- 5 · Las llaves, guardadas donde nadie las ve
-- ---------------------------------------------------------------
/**
 * Guarda o actualiza las credenciales de un método de pago.
 *
 * Nunca devuelve lo guardado. Quien las escribe puede volver a escribirlas,
 * pero no leerlas: una clave que se puede recuperar desde el navegador es una
 * clave que acaba en el portapapeles de alguien.
 */
create or replace function public.save_merchant_credentials(
  p_method_id   uuid,
  p_credentials jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metodo public.merchant_payment_methods;
  v_id     uuid;
begin
  select * into v_metodo from public.merchant_payment_methods where id = p_method_id;
  if not found then raise exception 'METHOD_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.has_staff_role(v_metodo.restaurant_id,
                               array['owner','admin','manager']::staff_role[])
     and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_credentials) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_metodo.secret_id is null then
    v_id := vault.create_secret(
      p_credentials::text,
      'pago_' || p_method_id::text,
      'Credenciales de pasarela');
    update public.merchant_payment_methods
       set secret_id = v_id, updated_at = now() where id = p_method_id;
  else
    perform vault.update_secret(v_metodo.secret_id, p_credentials::text);
    update public.merchant_payment_methods set updated_at = now() where id = p_method_id;
  end if;

  return jsonb_build_object('ok', true, 'fields', jsonb_object_keys_count(p_credentials));
end $$;

/** Cuántas llaves se guardaron, para poder decirlo sin decir cuáles. */
create or replace function public.jsonb_object_keys_count(p jsonb)
returns integer language sql immutable as $$
  select count(*)::int from jsonb_object_keys(p);
$$;

/**
 * Las credenciales, para quien tiene que llamar a la pasarela.
 *
 * Sólo `service_role`. El servidor de la aplicación las lee con esa llave para
 * construir la petición; ninguna sesión de persona llega hasta aquí, ni la del
 * dueño del local.
 */
create or replace function public.merchant_credentials(p_method_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret_id uuid;
  v_texto     text;
begin
  select secret_id into v_secret_id
    from public.merchant_payment_methods where id = p_method_id;
  if v_secret_id is null then
    return '{}'::jsonb;
  end if;

  select decrypted_secret into v_texto
    from vault.decrypted_secrets where id = v_secret_id;

  return coalesce(v_texto, '{}')::jsonb;
end $$;

-- ---------------------------------------------------------------
-- 6 · Qué puede elegir quien paga
-- ---------------------------------------------------------------
/**
 * Los métodos en línea que este local tiene encendidos.
 *
 * Sin credenciales ni receta: sólo lo que hace falta para pintar los botones.
 * Lo llama el escaparate, así que puede consultarlo cualquiera, y por eso no
 * puede devolver nada que no sea público.
 */
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
    'kind', p.kind
  ) order by m.position, p.name), '[]'::jsonb)
  from public.merchant_payment_methods m
  join public.payment_providers p on p.id = m.provider_id
  where m.restaurant_id = p_restaurant_id
    and m.is_active
    and p.is_active
    and p.kind = 'online'
    -- Encendido sin llaves no es un método de pago, es un botón que falla.
    and m.secret_id is not null;
$$;

-- ---------------------------------------------------------------
-- 7 · Permisos
--
-- Desde el bloque 0.3 nada se concede solo. Cada línea de aquí abajo es una
-- puerta que alguien abrió a propósito.
-- ---------------------------------------------------------------
alter table public.payment_providers enable row level security;
alter table public.payment_providers force row level security;
alter table public.merchant_payment_methods enable row level security;
alter table public.merchant_payment_methods force row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_intents force row level security;

drop policy if exists payment_providers_read on public.payment_providers;
create policy payment_providers_read on public.payment_providers
  for select to authenticated using (is_active or public.is_superadmin());

drop policy if exists payment_providers_write on public.payment_providers;
create policy payment_providers_write on public.payment_providers
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists merchant_methods_staff on public.merchant_payment_methods;
create policy merchant_methods_staff on public.merchant_payment_methods
  for all to authenticated
  using (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[])
         or public.is_superadmin())
  with check (public.has_staff_role(restaurant_id, array['owner','admin','manager']::staff_role[])
              or public.is_superadmin());

-- Los intentos se leen para saber qué pasó; se escriben sólo por función.
drop policy if exists payment_intents_read on public.payment_intents;
create policy payment_intents_read on public.payment_intents
  for select to authenticated
  using (public.is_staff_of(restaurant_id) or public.is_superadmin());

grant select on public.payment_providers to authenticated;
grant insert, update, delete on public.payment_providers to authenticated;
grant select, insert, update, delete on public.merchant_payment_methods to authenticated;
grant select on public.payment_intents to authenticated;

grant execute on function public.save_merchant_credentials(uuid, jsonb) to authenticated;
grant execute on function public.merchant_payment_options(uuid) to anon, authenticated;
grant execute on function public.jsonb_object_keys_count(jsonb) to authenticated;

-- Las credenciales sólo las lee el servidor, con su llave de servicio.
revoke all on function public.merchant_credentials(uuid) from public, anon, authenticated;
grant execute on function public.merchant_credentials(uuid) to service_role;
