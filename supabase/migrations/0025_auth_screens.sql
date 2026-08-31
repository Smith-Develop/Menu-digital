-- Imagen de la pantalla de bienvenida.
--
-- Las de acceso y registro ya existían en la tabla, pero no había ninguna para
-- la pantalla de carga, que es la primera que ve quien abre la aplicación
-- instalada. Se añade aquí para que el superadministrador pueda cambiar las tres
-- desde el mismo sitio.
alter table public.app_settings
  add column if not exists splash_image_url text,
  add column if not exists splash_title text,
  add column if not exists splash_subtitle text;

-- Los títulos de acceso y registro pasan a admitir nulos: dejarlos vacíos en el
-- panel significa "usa el texto de la marca", y para eso hace falta poder
-- guardar la ausencia de valor en vez de una cadena vacía.
alter table public.app_settings
  alter column login_title drop not null,
  alter column login_subtitle drop not null,
  alter column register_title drop not null,
  alter column register_subtitle drop not null;

-- Acceso con Apple: la tabla ya contemplaba Google y Facebook.
alter table public.app_settings
  add column if not exists social_apple boolean not null default false;

-- Cuánto se queda la pantalla de bienvenida antes de dar paso a la aplicación.
-- El superadministrador la ajusta según lo que quiera que dé tiempo a leer.
alter table public.app_settings
  add column if not exists splash_seconds smallint not null default 3;
