-- El rastro dejaba constancia de "cambio de total 0 → 29,70" en cada pedido
-- nuevo: no es un cambio, es el precio saliendo de la nada al crearlo. Lo que
-- hay que poder revisar después es un total que se mueve cuando ya había uno.
create or replace function public.audit_order_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  select s.role::text into v_rol
    from public.restaurant_staff s
   where s.restaurant_id = new.restaurant_id and s.user_id = auth.uid() and s.is_active
   limit 1;

  if new.manual_discount_cents is distinct from old.manual_discount_cents then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, reason, actor_id, actor_role)
    values (new.restaurant_id, 'order', new.id, 'discount',
            old.manual_discount_cents, new.manual_discount_cents,
            new.discount_reason, auth.uid(), v_rol);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'::order_status then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, reason, actor_id, actor_role)
    values (new.restaurant_id, 'order', new.id, 'cancel',
            old.total_cents, 0, new.cancel_reason, auth.uid(), v_rol);
  end if;

  -- Sólo cuando ya había un total: el primer cálculo de un pedido recién
  -- creado no es un cambio que nadie tenga que justificar.
  if old.total_cents > 0
     and new.total_cents is distinct from old.total_cents
     and new.manual_discount_cents is not distinct from old.manual_discount_cents
     and new.status is not distinct from old.status then
    insert into public.money_audit (restaurant_id, entity, entity_id, action,
                                    before_cents, after_cents, actor_id, actor_role)
    values (new.restaurant_id, 'order', new.id, 'total_change',
            old.total_cents, new.total_cents, auth.uid(), v_rol);
  end if;

  return null;
end;
$$;
