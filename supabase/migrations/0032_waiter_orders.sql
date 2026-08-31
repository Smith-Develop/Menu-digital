-- Quién tomó la comanda.
--
-- Cuando un camarero pide por el cliente, el pedido salía a nombre de nadie:
-- quedaba como uno más de la mesa y no había forma de saber quién lo había
-- levantado ni de valorar su trabajo.
alter table public.orders
  add column if not exists waiter_id uuid references public.profiles(id) on delete set null;

create index if not exists orders_waiter_idx on public.orders(waiter_id);

/**
 * Deja anotado al camarero cuando el pedido lo hace alguien del equipo.
 *
 * Se resuelve en la base y no en la aplicación porque el pedido puede entrar
 * por varios caminos, y aquí se sabe con certeza quién lo está creando. Un
 * cliente normal no es del equipo y la columna se queda vacía, que es lo que
 * distingue una comanda tomada en sala de un pedido hecho por el comensal.
 *
 * La mesa pasa además a manos de quien la levanta: quien toma la comanda es
 * quien la atiende, y así sus avisos le llegan sin tener que asignarse a mano.
 */
create or replace function public.tag_order_waiter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if exists (
    select 1 from public.restaurant_staff s
    where s.restaurant_id = new.restaurant_id
      and s.user_id = auth.uid()
      and s.is_active
  ) then
    new.waiter_id := auth.uid();

    if new.table_id is not null then
      update public.tables
         set assigned_waiter_id = auth.uid(),
             assigned_at = coalesce(assigned_at, now())
       where id = new.table_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_tag_waiter on public.orders;
create trigger orders_tag_waiter
  before insert on public.orders
  for each row execute function public.tag_order_waiter();
