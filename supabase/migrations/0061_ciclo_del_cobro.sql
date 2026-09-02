-- =============================================================
--  Bloque 1.3 · el ciclo de un cobro en línea
--
--  Cuatro momentos, y en cada uno una cosa que puede salir mal:
--
--    se crea el intento      → que el pedido ya esté pagado
--    se manda a la pasarela  → que no conteste
--    llega el aviso          → que llegue dos veces, tarde, o no llegue
--    se apunta en el libro   → que se apunte dos veces
--
--  El tercero y el cuarto son los que hunden un sistema de cobros, y los dos se
--  resuelven igual: por la referencia que da el proveedor. Si ya está apuntada,
--  no se vuelve a apuntar; y si alguien lo intenta igual, el índice único de la
--  migración anterior lo impide desde debajo.
--
--  Del segundo se ocupa la aplicación, que es quien habla HTTP. De que un aviso
--  no llegue nunca se ocupa el barrido del final: los webhooks se pierden, y un
--  sistema que dependa de que siempre lleguen acaba con pedidos cobrados que
--  figuran sin cobrar.
-- =============================================================

/**
 * Abre un intento de cobro para lo que falte de un pedido.
 *
 * Cierra los que hubiera abiertos antes. Dos intentos vivos sobre el mismo
 * pedido son dos formas de cobrarlo, y el cliente que vuelve atrás en el
 * navegador y prueba otra vez no debería poder pagar dos veces.
 */
create or replace function public.create_payment_intent(
  p_order_id  uuid,
  p_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders;
  v_metodo public.merchant_payment_methods;
  v_falta  int;
  v_id     uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Puede pagar quien atiende el local, quien hizo el pedido, o el servidor en
  -- nombre de un cliente sin cuenta —que ya ha demostrado tener el testigo del
  -- pedido antes de llegar hasta aquí—.
  if auth.uid() is not null
     and not public.is_staff_of(v_order.restaurant_id)
     and not public.is_superadmin()
     and v_order.customer_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED' using errcode = 'P0001';
  end if;

  select * into v_metodo from public.merchant_payment_methods
   where id = p_method_id and restaurant_id = v_order.restaurant_id and is_active;
  if not found then raise exception 'METHOD_NOT_AVAILABLE' using errcode = 'P0002'; end if;
  if v_metodo.secret_id is null then
    raise exception 'METHOD_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  v_falta := v_order.total_cents - v_order.paid_cents;
  if v_falta <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  update public.payment_intents
     set status = 'cancelled', updated_at = now()
   where order_id = p_order_id and status in ('pending', 'redirected');

  insert into public.payment_intents (
    order_id, restaurant_id, method_id, provider_id, amount_cents, currency, created_by
  ) values (
    p_order_id, v_order.restaurant_id, p_method_id, v_metodo.provider_id,
    v_falta, v_order.currency, auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'intent_id', v_id,
                            'amount_cents', v_falta, 'currency', v_order.currency);
end $$;

/** La pasarela contestó: se guarda su referencia y a dónde mandar al cliente. */
create or replace function public.mark_intent_redirected(
  p_intent_id    uuid,
  p_provider_ref text,
  p_redirect_url text,
  p_raw          jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_intents
     set status = 'redirected',
         provider_ref = p_provider_ref,
         redirect_url = p_redirect_url,
         raw = coalesce(p_raw, raw),
         updated_at = now()
   where id = p_intent_id and status = 'pending';

  if not found then raise exception 'INTENT_NOT_PENDING' using errcode = 'P0001'; end if;
  return jsonb_build_object('ok', true);
end $$;

/**
 * Llegó el aviso: se cierra el intento y, si hubo cobro, se apunta en el libro.
 *
 * Repetirla no cobra dos veces. Se comprueba por el estado del intento, y por
 * si acaso también por la referencia del proveedor: son dos candados sobre la
 * misma puerta porque un webhook duplicado es lo más normal del mundo y
 * equivocarse aquí cuesta dinero de verdad.
 */
create or replace function public.settle_payment_intent(
  p_intent_id    uuid,
  p_status       text,
  p_provider_ref text default null,
  p_raw          jsonb default null,
  p_fee_cents    integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.payment_intents;
  v_order  public.orders;
  v_ref    text;
begin
  select * into v_intent from public.payment_intents where id = p_intent_id for update;
  if not found then raise exception 'INTENT_NOT_FOUND' using errcode = 'P0002'; end if;

  v_ref := coalesce(p_provider_ref, v_intent.provider_ref);

  if v_intent.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true, 'status', 'paid');
  end if;

  if p_status <> 'paid' then
    update public.payment_intents
       set status = p_status::payment_intent_status,
           provider_ref = coalesce(v_ref, provider_ref),
           raw = coalesce(p_raw, raw),
           updated_at = now()
     where id = p_intent_id;
    return jsonb_build_object('ok', true, 'already', false, 'status', p_status);
  end if;

  select * into v_order from public.orders where id = v_intent.order_id for update;
  if v_order.status = 'cancelled' then
    -- Cobrar un pedido anulado no se arregla anotándolo: hay que devolverlo, y
    -- eso lo decide una persona mirando lo que pasó.
    update public.payment_intents
       set status = 'failed', error_code = 'ORDER_CANCELLED',
           provider_ref = v_ref, raw = coalesce(p_raw, raw), updated_at = now()
     where id = p_intent_id;
    return jsonb_build_object('ok', false, 'error', 'ORDER_CANCELLED');
  end if;

  begin
    insert into public.order_payments (
      order_id, restaurant_id, kind, amount_cents, method,
      provider_id, provider_ref, fee_cents, raw, note
    ) values (
      v_intent.order_id, v_intent.restaurant_id, 'charge', v_intent.amount_cents, 'online',
      v_intent.provider_id, v_ref, greatest(coalesce(p_fee_cents, 0), 0), p_raw,
      'Cobro en línea'
    );
  exception when unique_violation then
    -- Ya estaba apuntado: el aviso venía repetido. Se cierra el intento y se
    -- responde que sí, porque para el proveedor la operación está bien.
    update public.payment_intents
       set status = 'paid', provider_ref = v_ref, updated_at = now()
     where id = p_intent_id;
    return jsonb_build_object('ok', true, 'already', true, 'status', 'paid');
  end;

  update public.payment_intents
     set status = 'paid', provider_ref = v_ref, raw = coalesce(p_raw, raw), updated_at = now()
   where id = p_intent_id;

  select * into v_order from public.orders where id = v_intent.order_id;

  return jsonb_build_object(
    'ok', true, 'already', false, 'status', 'paid',
    'charged_cents', v_intent.amount_cents,
    'paid_cents', v_order.paid_cents,
    'fully_paid', v_order.payment_status = 'paid');
end $$;

/**
 * A qué comercio y a qué pasarela pertenece un aviso.
 *
 * Cada proveedor manda todos sus avisos a la misma dirección; el trozo de
 * dirección propio de cada método es lo que permite saber de quién es sin
 * probar firmas a ciegas.
 */
create or replace function public.method_by_webhook_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'method_id', m.id,
    'restaurant_id', m.restaurant_id,
    'provider_id', p.id,
    'slug', p.slug,
    'adapter', p.adapter,
    'spec', p.spec,
    'settings', m.settings
  )
  from public.merchant_payment_methods m
  join public.payment_providers p on p.id = m.provider_id
  where m.webhook_token = p_token and m.is_active and p.is_active;
$$;

/**
 * Los intentos que se quedaron en el aire.
 *
 * Un webhook que no llega deja el cobro en «redirigido» para siempre. Esto los
 * caduca para que dejen de bloquear al cliente que quiere volver a intentarlo,
 * y devuelve los que estaban redirigidos para que la aplicación pregunte al
 * proveedor qué pasó antes de darlos por perdidos.
 */
create or replace function public.expire_stale_intents()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dudosos jsonb;
  v_caducados int;
begin
  -- Los que llegaron a la pasarela merecen una pregunta antes que un entierro.
  select coalesce(jsonb_agg(jsonb_build_object(
           'intent_id', i.id, 'method_id', i.method_id, 'provider_ref', i.provider_ref)), '[]'::jsonb)
    into v_dudosos
    from public.payment_intents i
   where i.status = 'redirected' and i.expires_at < now() and i.provider_ref is not null;

  with fuera as (
    update public.payment_intents
       set status = 'expired', updated_at = now()
     where status = 'pending' and expires_at < now()
     returning 1
  ) select count(*)::int into v_caducados from fuera;

  return jsonb_build_object('expired', v_caducados, 'to_check', v_dudosos);
end $$;

-- ---------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------
grant execute on function public.create_payment_intent(uuid, uuid) to authenticated, service_role;

-- Lo que sólo toca el servidor: hablar con la pasarela y creerse su respuesta.
revoke all on function public.mark_intent_redirected(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.settle_payment_intent(uuid, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.method_by_webhook_token(text) from public, anon, authenticated;
revoke all on function public.expire_stale_intents() from public, anon, authenticated;

grant execute on function public.mark_intent_redirected(uuid, text, text, jsonb) to service_role;
grant execute on function public.settle_payment_intent(uuid, text, text, jsonb, integer) to service_role;
grant execute on function public.method_by_webhook_token(text) to service_role;
grant execute on function public.expire_stale_intents() to service_role;
