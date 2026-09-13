-- =============================================================
--  El entorno lo declara la pasarela, y nadie más
--
--  La migración 0081 añadió `live_mode` para guardar lo que la pasarela dice de
--  sus propias llaves, y lo dejó donde el comercio puede escribirlo: su
--  política de actualización cubre la fila entera, columnas nuevas incluidas.
--
--  Lo encontró la prueba al intentarlo. Un comercio que marca sus llaves reales
--  como «de prueba» se engaña sobre todo a sí mismo, pero el valor de este
--  campo está justamente en que no es opinable: es la única fuente que no se
--  equivoca sobre si un cobro movió dinero de verdad. Un dato que cualquiera
--  puede escribir deja de servir para eso.
--
--  Se protege con un disparador y no con permisos por columna porque un permiso
--  por columna obliga a enumerar todas las demás, y la siguiente que se añada
--  se quedaría fuera sin que nadie lo note. El disparador sólo habla de lo que
--  protege.
-- =============================================================

create or replace function public.guard_live_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sin sesión es el servidor con la llave de servicio, que es quien acaba de
  -- hablar con la pasarela. Es el único que sabe la respuesta.
  if auth.uid() is null then
    return new;
  end if;

  if new.live_mode is distinct from old.live_mode
     or new.live_mode_at is distinct from old.live_mode_at then
    new.live_mode := old.live_mode;
    new.live_mode_at := old.live_mode_at;
  end if;

  return new;
end $$;

drop trigger if exists merchant_payment_methods_entorno on public.merchant_payment_methods;
create trigger merchant_payment_methods_entorno
  before update on public.merchant_payment_methods
  for each row execute function public.guard_live_mode();
