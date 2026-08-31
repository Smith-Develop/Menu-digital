-- Cupones guardados por el cliente.
--
-- Al canjear un código válido, queda anotado en su cuenta para no tener que
-- recordarlo la próxima vez. Se guarda el cupón, no el descuento: si el
-- restaurante lo retira, lo caduca o se agotan los usos, deja de ofrecerse solo.
create table if not exists public.customer_coupons (
  user_id uuid not null references auth.users(id) on delete cascade,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, coupon_id)
);

alter table public.customer_coupons enable row level security;
alter table public.customer_coupons force row level security;

create policy customer_coupons_own on public.customer_coupons
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/**
 * Cupones guardados que todavía sirven.
 *
 * Descarta los caducados, los desactivados, los que agotaron su cupo global y
 * aquellos que esa persona ya usó tantas veces como se le permitía: enseñar un
 * cupón que el carrito va a rechazar es peor que no enseñarlo.
 */
create or replace function public.my_coupons()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code,
    'kind', c.kind,
    'percentage', c.percentage,
    'value_cents', c.value_cents,
    'min_order_cents', c.min_order_cents,
    'description', c.description,
    'ends_at', c.ends_at,
    'restaurant_id', c.restaurant_id,
    'restaurant_name', r.name,
    'used', coalesce(u.usos, 0),
    'max_per_customer', c.max_per_customer
  ) order by c.ends_at nulls last), '[]'::jsonb)
  from public.customer_coupons mc
  join public.coupons c on c.id = mc.coupon_id
  left join public.restaurants r on r.id = c.restaurant_id
  left join lateral (
    select count(*) as usos
    from public.coupon_redemptions cr
    where cr.coupon_id = c.id and cr.customer_id = auth.uid()
  ) u on true
  where mc.user_id = auth.uid()
    and c.is_active
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at >= now())
    and (c.max_redemptions is null or c.redemptions_count < c.max_redemptions)
    and (c.max_per_customer is null or coalesce(u.usos, 0) < c.max_per_customer);
$$;

grant execute on function public.my_coupons() to authenticated;

-- El slug permite que el carrito distinga los cupones de su propio local.

create or replace function public.my_coupons()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code,
    'kind', c.kind,
    'percentage', c.percentage,
    'value_cents', c.value_cents,
    'min_order_cents', c.min_order_cents,
    'description', c.description,
    'ends_at', c.ends_at,
    'restaurant_id', c.restaurant_id,
    'restaurant_name', r.name,
    'restaurant_slug', r.slug,
    'used', coalesce(u.usos, 0),
    'max_per_customer', c.max_per_customer
  ) order by c.ends_at nulls last), '[]'::jsonb)
  from public.customer_coupons mc
  join public.coupons c on c.id = mc.coupon_id
  left join public.restaurants r on r.id = c.restaurant_id
  left join lateral (
    select count(*) as usos
    from public.coupon_redemptions cr
    where cr.coupon_id = c.id and cr.customer_id = auth.uid()
  ) u on true
  where mc.user_id = auth.uid()
    and c.is_active
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at >= now())
    and (c.max_redemptions is null or c.redemptions_count < c.max_redemptions)
    and (c.max_per_customer is null or coalesce(u.usos, 0) < c.max_per_customer);
$$;
