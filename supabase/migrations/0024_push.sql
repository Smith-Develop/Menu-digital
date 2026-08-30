-- Notificaciones push al teléfono del cliente.
--
-- Una suscripción puede no tener cuenta detrás: los pedidos en mesa no exigen
-- iniciar sesión, y aun así su cliente debe enterarse de que la comida va en
-- camino. Por eso `user_id` admite nulos y existe `order_push_targets`, que ata
-- una suscripción anónima a los pedidos concretos que hizo ese navegador.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  city_slug text,
  locale text default 'es',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_city_idx on public.push_subscriptions(city_slug);

create table if not exists public.order_push_targets (
  order_id uuid not null references public.orders(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (order_id, subscription_id)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.order_push_targets enable row level security;
alter table public.order_push_targets force row level security;

-- Nadie lee estas tablas desde el navegador: el envío ocurre en el servidor con
-- la clave de servicio. Las altas y bajas pasan por rutas de API propias, que
-- validan el pedido antes de vincularlo.
create policy push_subscriptions_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());

create policy order_push_targets_admin on public.order_push_targets
  for select to authenticated using (public.is_superadmin());
