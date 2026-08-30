-- =============================================================
--  Yumi · pantallas de bienvenida y acceso, editables
--
--  El superadministrador cambia textos e ilustraciones sin tocar código.
-- =============================================================

-- ---------- Diapositivas de bienvenida ----------
create table if not exists public.onboarding_slides (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  subtitle    text,
  image_url   text,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists onboarding_slides_order_idx
  on public.onboarding_slides (position) where is_active;

drop trigger if exists set_updated_at on public.onboarding_slides;
create trigger set_updated_at before update on public.onboarding_slides
  for each row execute function public.touch_updated_at();

-- ---------- Textos de las pantallas de acceso ----------
alter table public.app_settings add column if not exists splash_enabled boolean not null default true;
alter table public.app_settings add column if not exists onboarding_enabled boolean not null default true;
alter table public.app_settings add column if not exists login_title text not null default 'Bienvenido de nuevo';
alter table public.app_settings add column if not exists login_subtitle text not null default 'Inicia sesión para acceder a tu cuenta';
alter table public.app_settings add column if not exists login_image_url text;
alter table public.app_settings add column if not exists register_title text not null default 'Empecemos';
alter table public.app_settings add column if not exists register_subtitle text not null default 'Crea tu cuenta gratis';
alter table public.app_settings add column if not exists register_image_url text;
alter table public.app_settings add column if not exists social_google boolean not null default false;
alter table public.app_settings add column if not exists social_facebook boolean not null default false;
alter table public.app_settings add column if not exists terms_url text;
alter table public.app_settings add column if not exists privacy_url text;

-- ---------- Diapositivas de partida ----------
insert into public.onboarding_slides (title, subtitle, image_url, position)
select * from (values
  ('Descubre tu ciudad, plato a plato',
   'Los restaurantes de tu zona, con su carta al día y fotos de verdad.',
   'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=900&h=900&fit=crop',
   1),
  ('Pide desde la mesa o desde el sofá',
   'Escanea el QR de tu mesa o recíbelo en casa. Tú eliges.',
   'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&h=900&fit=crop',
   2),
  ('Sigue tu pedido en tiempo real',
   'Sabrás cuándo entra en cocina y cuándo sale hacia tu puerta.',
   'https://images.unsplash.com/photo-1526367790999-0150786686a2?w=900&h=900&fit=crop',
   3)
) as v(title, subtitle, image_url, position)
where not exists (select 1 from public.onboarding_slides);

-- ---------- RLS ----------
alter table public.onboarding_slides enable row level security;
alter table public.onboarding_slides force row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname='public' and tablename='onboarding_slides'
  loop
    execute format('drop policy if exists %I on public.onboarding_slides', r.policyname);
  end loop;
end $$;

create policy onboarding_public_read on public.onboarding_slides
  for select to anon, authenticated using (is_active or public.is_superadmin());

create policy onboarding_superadmin_write on public.onboarding_slides
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());
