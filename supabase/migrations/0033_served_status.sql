-- "Servido en mesa": el plato ya está delante del comensal.
--
-- Faltaba el paso intermedio entre que la cocina lo da por listo y que la mesa
-- se cierra. Sin él, "entregado" tenía que significar las dos cosas a la vez y
-- el camarero no tenía forma de marcar que ya lo había llevado sin dar por
-- terminada la cuenta.
--
-- Va detrás de `ready` en el orden del enumerado para que las comparaciones y
-- los listados sigan un orden natural.
do $$ begin
  alter type public.order_status add value if not exists 'served' after 'ready';
exception when others then null;
end $$;

/**
 * Quien mueve un pedido de mesa se queda con esa mesa.
 *
 * Aceptar la comanda desde la propia pantalla ya es hacerse cargo de ella: es
 * el momento en que un camarero decide que ese pedido es suyo. Antes había que
 * asignarse la mesa aparte, y hasta entonces sus avisos no le llegaban.
 *
 * Sólo actúa si el pedido no tiene ya camarero: quien lo levantó manda sobre
 * quien luego lo mueva por la cocina.
 */
create or replace function public.claim_order_waiter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or new.status = old.status then
    return new;
  end if;

  if exists (
    select 1 from public.restaurant_staff s
    where s.restaurant_id = new.restaurant_id
      and s.user_id = auth.uid()
      and s.is_active
  ) then
    if new.waiter_id is null then
      new.waiter_id := auth.uid();
    end if;

    if new.table_id is not null then
      update public.tables
         set assigned_waiter_id = coalesce(assigned_waiter_id, auth.uid()),
             assigned_at = coalesce(assigned_at, now())
       where id = new.table_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_claim_waiter on public.orders;
create trigger orders_claim_waiter
  before update of status on public.orders
  for each row execute function public.claim_order_waiter();
