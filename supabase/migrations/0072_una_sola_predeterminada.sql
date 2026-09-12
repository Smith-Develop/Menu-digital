-- =============================================================
--  Quién es la dirección de siempre
--
--  El índice parcial de la migración 0070 garantiza que no haya dos
--  predeterminadas, pero no dice cómo se cambia de una a otra: hacerlo desde la
--  aplicación son dos escrituras —apagar la vieja, encender la nueva— y entre
--  las dos cabe un fallo que deja al cliente sin ninguna.
--
--  Aquí van las tres reglas que la libreta necesita para cuidarse sola:
--  la primera dirección manda, cambiar de predeterminada es una sola operación,
--  y borrar la de siempre asciende a otra en vez de dejar el hueco.
-- =============================================================

/**
 * La primera dirección de un cliente es la de siempre.
 *
 * Sin esto, quien guarda una sola dirección no tiene ninguna predeterminada y
 * el checkout no sabe cuál proponerle, que es justo el caso más común.
 */
create or replace function public.first_address_is_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.customer_addresses
     where user_id = new.user_id and id is distinct from new.id
  ) then
    new.is_default := true;
  end if;
  return new;
end $$;

drop trigger if exists customer_addresses_primera on public.customer_addresses;
create trigger customer_addresses_primera
  before insert on public.customer_addresses
  for each row execute function public.first_address_is_default();

/**
 * Cambiar la dirección de siempre, en una sola operación.
 *
 * Comprueba la propiedad aunque la política ya lo haga: esta función es
 * `security definer` y salta RLS, así que la comprobación no es redundante,
 * es la única que queda.
 */
create or replace function public.set_default_address(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.customer_addresses where id = p_id;
  if v_user is null then raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_user is distinct from auth.uid() then
    raise exception 'ADDRESS_NOT_YOURS' using errcode = 'P0001';
  end if;

  update public.customer_addresses
     set is_default = false, updated_at = now()
   where user_id = v_user and is_default and id <> p_id;

  update public.customer_addresses
     set is_default = true, updated_at = now()
   where id = p_id;
end $$;

grant execute on function public.set_default_address(uuid) to authenticated;

/**
 * Al borrar la de siempre, asciende la siguiente.
 *
 * Va `after delete` porque hasta que la fila no se ha ido no se puede encender
 * otra: el índice parcial no admite dos a la vez.
 */
create or replace function public.promote_next_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_default then
    update public.customer_addresses
       set is_default = true, updated_at = now()
     where id = (
       select id from public.customer_addresses
        where user_id = old.user_id
        order by created_at desc
        limit 1
     );
  end if;
  return null;
end $$;

drop trigger if exists customer_addresses_ascender on public.customer_addresses;
create trigger customer_addresses_ascender
  after delete on public.customer_addresses
  for each row execute function public.promote_next_address();
