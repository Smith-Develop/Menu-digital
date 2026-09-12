-- =============================================================
--  Los países y sus ciudades los pone la plataforma
--
--  Estaban escritos en el código, que es tanto como decir que añadir Guatemala
--  exigía un despliegue. Y la lista era la misma para todos: un local de
--  Tegucigalpa elegía entre veinticuatro países y ciento cuarenta ciudades para
--  encontrar la suya.
--
--  Ahora los pone el superadministrador. Cada país trae su divisa y su hora
--  —que se proponen al elegirlo— y sus ciudades, y se le asignan las pasarelas
--  que la plataforma ofrece ahí. Así la lista que ve cada comercio es corta y
--  es la suya.
--
--  Sobre las pasarelas hay dos cosas distintas que conviene no confundir, y por
--  eso se guardan aparte: dónde **opera** una pasarela es un hecho del mundo y
--  vive en la propia pasarela; qué pasarelas **se ofrecen** en un país es una
--  decisión de negocio y vive aquí. Asignar una donde no opera se puede, pero
--  la pantalla avisa.
-- =============================================================

create table if not exists public.platform_countries (
  code      char(2) primary key,
  name      text not null,
  currency  char(3) not null,
  timezone  text not null,
  is_active boolean not null default true,
  position  integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_cities (
  id         uuid primary key default gen_random_uuid(),
  country    char(2) not null references public.platform_countries(code) on delete cascade,
  name       text not null,
  -- El mismo identificador que llevan los restaurantes, para poder cruzarlos.
  slug       text generated always as (public.slugify(name)) stored,
  is_active  boolean not null default true,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  unique (country, name)
);

create index if not exists platform_cities_pais_idx
  on public.platform_cities (country, position, name) where is_active;

/**
 * Qué pasarelas ofrece la plataforma en cada país.
 *
 * Es una decisión de negocio, no un hecho: se puede tener cuenta con cuatro
 * pasarelas que operan en Colombia y ofrecer sólo dos.
 */
create table if not exists public.country_payment_providers (
  country     char(2) not null references public.platform_countries(code) on delete cascade,
  provider_id uuid not null references public.payment_providers(id) on delete cascade,
  position    integer not null default 0,
  primary key (country, provider_id)
);

-- ---------------------------------------------------------------
-- La semilla: lo que hasta ahora estaba escrito en el código
-- ---------------------------------------------------------------
insert into public.platform_countries (code, name, currency, timezone, position) values
  ('CO', 'Colombia', 'COP', 'America/Bogota', 0),
  ('HN', 'Honduras', 'HNL', 'America/Tegucigalpa', 10),
  ('ES', 'España', 'EUR', 'Europe/Madrid', 20),
  ('AR', 'Argentina', 'ARS', 'America/Argentina/Buenos_Aires', 30),
  ('BO', 'Bolivia', 'BOB', 'America/La_Paz', 40),
  ('BR', 'Brasil', 'BRL', 'America/Sao_Paulo', 50),
  ('CL', 'Chile', 'CLP', 'America/Santiago', 60),
  ('CR', 'Costa Rica', 'CRC', 'America/Costa_Rica', 70),
  ('CU', 'Cuba', 'CUP', 'America/Havana', 80),
  ('EC', 'Ecuador', 'USD', 'America/Guayaquil', 90),
  ('SV', 'El Salvador', 'USD', 'America/El_Salvador', 100),
  ('US', 'Estados Unidos', 'USD', 'America/New_York', 110),
  ('GT', 'Guatemala', 'GTQ', 'America/Guatemala', 120),
  ('MX', 'México', 'MXN', 'America/Mexico_City', 130),
  ('NI', 'Nicaragua', 'NIO', 'America/Managua', 140),
  ('PA', 'Panamá', 'PAB', 'America/Panama', 150),
  ('PY', 'Paraguay', 'PYG', 'America/Asuncion', 160),
  ('PE', 'Perú', 'PEN', 'America/Lima', 170),
  ('PT', 'Portugal', 'EUR', 'Europe/Lisbon', 180),
  ('PR', 'Puerto Rico', 'USD', 'America/Puerto_Rico', 190),
  ('DO', 'República Dominicana', 'DOP', 'America/Santo_Domingo', 200),
  ('UY', 'Uruguay', 'UYU', 'America/Montevideo', 210),
  ('VE', 'Venezuela', 'VES', 'America/Caracas', 220)
on conflict (code) do update set
  name = excluded.name, currency = excluded.currency,
  timezone = excluded.timezone, position = excluded.position;

insert into public.platform_cities (country, name, position) values
  ('CO', 'Armenia', 0),
  ('CO', 'Barranquilla', 10),
  ('CO', 'Bello', 20),
  ('CO', 'Bogotá', 30),
  ('CO', 'Bucaramanga', 40),
  ('CO', 'Buenaventura', 50),
  ('CO', 'Cali', 60),
  ('CO', 'Cartagena', 70),
  ('CO', 'Cúcuta', 80),
  ('CO', 'Dosquebradas', 90),
  ('CO', 'Envigado', 100),
  ('CO', 'Florencia', 110),
  ('CO', 'Ibagué', 120),
  ('CO', 'Itagüí', 130),
  ('CO', 'Manizales', 140),
  ('CO', 'Medellín', 150),
  ('CO', 'Montería', 160),
  ('CO', 'Neiva', 170),
  ('CO', 'Palmira', 180),
  ('CO', 'Pasto', 190),
  ('CO', 'Pereira', 200),
  ('CO', 'Popayán', 210),
  ('CO', 'Riohacha', 220),
  ('CO', 'Santa Marta', 230),
  ('CO', 'Sincelejo', 240),
  ('CO', 'Soacha', 250),
  ('CO', 'Soledad', 260),
  ('CO', 'Tuluá', 270),
  ('CO', 'Tunja', 280),
  ('CO', 'Valledupar', 290),
  ('CO', 'Villavicencio', 300),
  ('CO', 'Yopal', 310),
  ('HN', 'Choloma', 0),
  ('HN', 'Choluteca', 10),
  ('HN', 'Comayagua', 20),
  ('HN', 'Danlí', 30),
  ('HN', 'El Progreso', 40),
  ('HN', 'Juticalpa', 50),
  ('HN', 'La Ceiba', 60),
  ('HN', 'La Lima', 70),
  ('HN', 'Olanchito', 80),
  ('HN', 'Puerto Cortés', 90),
  ('HN', 'Roatán', 100),
  ('HN', 'Santa Rosa de Copán', 110),
  ('HN', 'San Pedro Sula', 120),
  ('HN', 'Siguatepeque', 130),
  ('HN', 'Tegucigalpa', 140),
  ('HN', 'Tela', 150),
  ('HN', 'Tocoa', 160),
  ('HN', 'Villanueva', 170),
  ('ES', 'A Coruña', 0),
  ('ES', 'Albacete', 10),
  ('ES', 'Alicante', 20),
  ('ES', 'Almería', 30),
  ('ES', 'Badajoz', 40),
  ('ES', 'Barcelona', 50),
  ('ES', 'Bilbao', 60),
  ('ES', 'Burgos', 70),
  ('ES', 'Cádiz', 80),
  ('ES', 'Cartagena', 90),
  ('ES', 'Castellón', 100),
  ('ES', 'Córdoba', 110),
  ('ES', 'Elche', 120),
  ('ES', 'Getafe', 130),
  ('ES', 'Gijón', 140),
  ('ES', 'Girona', 150),
  ('ES', 'Granada', 160),
  ('ES', 'Huelva', 170),
  ('ES', 'Jaén', 180),
  ('ES', 'Las Palmas', 190),
  ('ES', 'León', 200),
  ('ES', 'Lleida', 210),
  ('ES', 'Logroño', 220),
  ('ES', 'Lugo', 230),
  ('ES', 'Madrid', 240),
  ('ES', 'Málaga', 250),
  ('ES', 'Marbella', 260),
  ('ES', 'Murcia', 270),
  ('ES', 'Ourense', 280),
  ('ES', 'Oviedo', 290),
  ('ES', 'Palma', 300),
  ('ES', 'Pamplona', 310),
  ('ES', 'Salamanca', 320),
  ('ES', 'San Sebastián', 330),
  ('ES', 'Santa Cruz de Tenerife', 340),
  ('ES', 'Santander', 350),
  ('ES', 'Sevilla', 360),
  ('ES', 'Tarragona', 370),
  ('ES', 'Toledo', 380),
  ('ES', 'Valencia', 390),
  ('ES', 'Valladolid', 400),
  ('ES', 'Vigo', 410),
  ('ES', 'Vitoria', 420),
  ('ES', 'Zaragoza', 430)
on conflict (country, name) do nothing;

-- Y las pasarelas se ofrecen, de entrada, donde cada una dice que opera.
insert into public.country_payment_providers (country, provider_id)
select c.code, p.id
  from public.platform_countries c
  join public.payment_providers p
    on cardinality(p.countries) = 0 or c.code = any (p.countries)
 where p.is_active
on conflict do nothing;

-- ---------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------
alter table public.platform_countries enable row level security;
alter table public.platform_countries force row level security;
alter table public.platform_cities enable row level security;
alter table public.platform_cities force row level security;
alter table public.country_payment_providers enable row level security;
alter table public.country_payment_providers force row level security;

-- El alta de un local ocurre antes de tener sesión de equipo, así que la lista
-- tiene que poder leerse sin ella. No hay nada reservado en un país.
drop policy if exists platform_countries_read on public.platform_countries;
create policy platform_countries_read on public.platform_countries
  for select to anon, authenticated using (is_active or public.is_superadmin());

drop policy if exists platform_countries_write on public.platform_countries;
create policy platform_countries_write on public.platform_countries
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists platform_cities_read on public.platform_cities;
create policy platform_cities_read on public.platform_cities
  for select to anon, authenticated using (is_active or public.is_superadmin());

drop policy if exists platform_cities_write on public.platform_cities;
create policy platform_cities_write on public.platform_cities
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

drop policy if exists country_providers_read on public.country_payment_providers;
create policy country_providers_read on public.country_payment_providers
  for select to anon, authenticated using (true);

drop policy if exists country_providers_write on public.country_payment_providers;
create policy country_providers_write on public.country_payment_providers
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

grant select on public.platform_countries to anon, authenticated;
grant insert, update, delete on public.platform_countries to authenticated;
grant select on public.platform_cities to anon, authenticated;
grant insert, update, delete on public.platform_cities to authenticated;
grant select on public.country_payment_providers to anon, authenticated;
grant insert, update, delete on public.country_payment_providers to authenticated;
