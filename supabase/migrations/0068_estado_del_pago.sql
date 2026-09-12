-- =============================================================
--  Que quien paga pueda ver si su pago llegó
--
--  La pantalla de vuelta de la pasarela tiene que esperar unos segundos a que
--  llegue el aviso, y mientras tanto preguntar. Pero quien paga puede no tener
--  cuenta —en el escaparate se pide sin registrarse— y las políticas de
--  `payment_intents` sólo dejan mirar al equipo del local, con razón.
--
--  Esto devuelve lo justo para pintar esa pantalla: en qué estado está y de
--  cuánto era. Nada de referencias del proveedor, ni de respuestas crudas, ni
--  de qué local es. Saberlo exige tener el identificador del intento, que sólo
--  tiene quien acaba de ser redirigido a él.
-- =============================================================

create or replace function public.payment_intent_state(p_intent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status', i.status,
    'amount_cents', i.amount_cents,
    'currency', i.currency
  )
  from public.payment_intents i
  where i.id = p_intent_id;
$$;

grant execute on function public.payment_intent_state(uuid) to anon, authenticated;
