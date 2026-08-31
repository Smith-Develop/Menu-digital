-- Sala: quién atiende cada mesa.
--
-- Al sentarse un cliente se le asigna un camarero, y a partir de ahí los avisos
-- de esa mesa le llegan a él además de a la comanda principal.
alter table public.tables
  add column if not exists assigned_waiter_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz;

create index if not exists tables_waiter_idx on public.tables(assigned_waiter_id);

/**
 * Estado de la sala.
 *
 * Una mesa está ocupada cuando tiene algo pendiente de cobrar: es el mismo
 * criterio que vacía la cuenta del comensal, así que la sala y lo que ve el
 * cliente nunca se contradicen.
 */
create or replace function public.floor_status(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'code', t.code,
      'seats', t.seats,
      'waiter_id', t.assigned_waiter_id,
      'waiter_name', p.full_name,
      'assigned_at', t.assigned_at,
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'code', o.code,
          'status', o.status,
          'payment_status', o.payment_status,
          'total_cents', o.total_cents,
          'created_at', o.created_at) order by o.created_at)
        from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), '[]'::jsonb),
      'total_cents', coalesce((
        select sum(o.total_cents) from public.orders o
        where o.table_id = t.id
          and o.status <> 'cancelled'
          and o.payment_status <> 'paid'), 0),
      'pending_calls', coalesce((
        select count(*) from public.waiter_calls w
        where w.table_id = t.id and w.attended_at is null), 0)
    ) as x
    from public.tables t
    left join public.profiles p on p.id = t.assigned_waiter_id
    where t.restaurant_id = p_restaurant_id
      and t.is_active
  ) s
  where public.is_staff_of(p_restaurant_id) or public.is_superadmin();
$$;

grant execute on function public.floor_status(uuid) to authenticated;
