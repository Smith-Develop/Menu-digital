-- Turno de mesa.
--
-- La cookie que deja el QR no caducaba nunca, así que quien había comido en el
-- local seguía "sentado en la mesa 7" días después: al abrir la aplicación desde
-- su casa se encontraba el carrito del restaurante en vez del de reparto.
--
-- Cada mesa lleva ahora un identificador de turno. La cookie guarda el que
-- había al escanear, y cuando la cuenta de la mesa queda saldada el turno se
-- renueva: todas las cookies del turno anterior dejan de valer en ese mismo
-- momento, que es justo lo que separa a un comensal del siguiente.
alter table public.tables
  add column if not exists session_id uuid not null default gen_random_uuid();

/**
 * Cierra el turno cuando ya no queda nada por cobrar en la mesa.
 *
 * Se dispara al cobrar y también al cancelar, porque un pedido cancelado deja
 * de contar como cuenta abierta igual que uno pagado.
 */
create or replace function public.close_table_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.table_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.orders o
    where o.table_id = new.table_id
      and o.status <> 'cancelled'
      and o.payment_status <> 'paid'
  ) then
    update public.tables
       set session_id = gen_random_uuid(),
           assigned_waiter_id = null,
           assigned_at = null
     where id = new.table_id;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_close_table_session on public.orders;
create trigger orders_close_table_session
  after update of payment_status, status on public.orders
  for each row
  when (new.payment_status = 'paid' or new.status = 'cancelled')
  execute function public.close_table_session();

/**
 * ¿Sigue viva la sesión que trae el navegador?
 *
 * Devuelve el código de la mesa sólo si el turno coincide. Es una función
 * propia y no una consulta directa porque `tables` no es legible por los
 * clientes y aquí sólo se confirma algo que ya tenían.
 */
create or replace function public.table_session_alive(p_code text, p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tables t
    where t.code = p_code
      and t.is_active
      and t.session_id = p_session
  );
$$;

grant execute on function public.table_session_alive(text, uuid) to anon, authenticated;
