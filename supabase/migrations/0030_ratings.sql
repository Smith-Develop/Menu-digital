-- Valoraciones.
--
-- Una sola tabla para todo lo que se puede puntuar —el restaurante, el plato,
-- quien repartió y quien atendió— porque la pregunta es siempre la misma y
-- separarlas en cuatro tablas obligaría a repetir cuatro veces las políticas,
-- los promedios y la pantalla.
--
-- La valoración cuelga siempre de un pedido: es lo que demuestra que quien
-- puntúa estuvo allí, y lo que impide puntuar dos veces lo mismo.
do $$ begin
  create type public.rating_target as enum ('restaurant', 'product', 'courier', 'waiter');
exception when duplicate_object then null;
end $$;

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  target_type public.rating_target not null,
  target_id uuid not null,
  score smallint not null check (score between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (order_id, target_type, target_id)
);

create index if not exists ratings_target_idx on public.ratings(target_type, target_id);

alter table public.ratings enable row level security;
alter table public.ratings force row level security;

-- Las valoraciones se leen en las fichas públicas.
create policy ratings_public_read on public.ratings
  for select to anon, authenticated using (true);

-- Sólo se puntúa lo propio, y sólo sobre un pedido ya entregado.
create policy ratings_own_write on public.ratings
  for insert to authenticated
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.customer_id = auth.uid()
        and o.status = 'completed'
    )
  );

create policy ratings_own_update on public.ratings
  for update to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

/**
 * Mantiene al día la nota media de restaurantes y repartidores.
 *
 * Se recalcula en el momento en lugar de leer la tabla entera cada vez que
 * alguien abre una ficha: las valoraciones se escriben pocas veces y se leen
 * muchas.
 */
create or replace function public.apply_rating_average()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  media numeric;
  total int;
begin
  select round(avg(score)::numeric, 2), count(*)
    into media, total
    from public.ratings
   where target_type = new.target_type and target_id = new.target_id;

  if new.target_type = 'restaurant' then
    update public.restaurants
       set rating = media, rating_count = total
     where id = new.target_id;
  elsif new.target_type = 'courier' then
    update public.couriers
       set rating = media, rating_count = total
     where id = new.target_id;
  end if;

  return new;
end;
$$;

drop trigger if exists ratings_average on public.ratings;
create trigger ratings_average
  after insert or update on public.ratings
  for each row execute function public.apply_rating_average();

/**
 * Qué se puede valorar de un pedido y qué ya se valoró.
 *
 * Devuelve el restaurante, cada plato, el repartidor si lo hubo y el camarero
 * si la mesa tenía uno asignado, con la nota puesta si ya existe.
 */
create or replace function public.order_rating_targets(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pedido as (
    select o.* from public.orders o
    where o.id = p_order_id and o.customer_id = auth.uid() and o.status = 'completed'
  )
  select case when not exists (select 1 from pedido) then '[]'::jsonb else (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (

      select jsonb_build_object(
        'type', 'restaurant', 'id', r.id, 'name', r.name, 'image', r.logo_url,
        'score', (select score from public.ratings g
                   where g.order_id = p.id and g.target_type = 'restaurant' and g.target_id = r.id)
      ) as x
      from pedido p join public.restaurants r on r.id = p.restaurant_id

      union all

      select jsonb_build_object(
        'type', 'product', 'id', pr.id, 'name', pr.name, 'image', pr.image_url,
        'score', (select score from public.ratings g
                   where g.order_id = p.id and g.target_type = 'product' and g.target_id = pr.id)
      )
      from pedido p
      join public.order_items i on i.order_id = p.id
      join public.products pr on pr.id = i.product_id
      group by p.id, pr.id, pr.name, pr.image_url

      union all

      select jsonb_build_object(
        'type', 'courier', 'id', c.id, 'name', coalesce(pf.full_name, pf.email), 'image', pf.avatar_url,
        'score', (select score from public.ratings g
                   where g.order_id = p.id and g.target_type = 'courier' and g.target_id = c.id)
      )
      from pedido p
      join public.couriers c on c.id = p.courier_id
      join public.profiles pf on pf.id = c.user_id

      union all

      select jsonb_build_object(
        'type', 'waiter', 'id', pf.id, 'name', coalesce(pf.full_name, pf.email), 'image', pf.avatar_url,
        'score', (select score from public.ratings g
                   where g.order_id = p.id and g.target_type = 'waiter' and g.target_id = pf.id)
      )
      from pedido p
      join public.tables t on t.id = p.table_id
      join public.profiles pf on pf.id = t.assigned_waiter_id
    ) s
  ) end;
$$;

grant execute on function public.order_rating_targets(uuid) to authenticated;
