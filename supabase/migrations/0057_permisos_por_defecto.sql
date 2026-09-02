-- =============================================================
--  Bloque 0.3 · la base deja de nacer abierta
--
--  En este esquema todo lo que se crea nace con permisos completos para `anon`
--  y `authenticated`: es el privilegio por defecto que trae la instalación. La
--  única barrera era la política RLS de cada tabla y la comprobación que cada
--  función lleva dentro. Aguantaba —las dieciséis llamadas anónimas contra el
--  dinero rebotaban todas— pero era una barrera de un solo hilo, y la auditoría
--  encontró una tabla suelta que lo demostraba.
--
--  Aquí se invierte: nada tiene permiso salvo lo que se conceda a mano. Lo
--  concedido no se ha inventado, se ha deducido de tres sitios que ya lo
--  decían: las políticas escritas —una política para un rol sólo tiene sentido
--  si ese rol puede llegar a la tabla—, las concesiones explícitas de las 56
--  migraciones anteriores, y las funciones que la aplicación llama de verdad.
--  Las tres coincidieron: ninguna de las 61 llamadas de la aplicación se quedó
--  sin cobertura, y las 8 funciones que usan las políticas conservan su permiso.
--
--  Lo que pierde el permiso son 36 funciones que nadie llama desde fuera:
--  disparadores, guardianes y ayudantes internos que se ejecutan dentro de otras
--  funciones, donde el permiso del que llama no pinta nada.
-- =============================================================

-- ---------------------------------------------------------------
-- 1 · Lo que se cree a partir de ahora nace cerrado
--
-- Hay dos roles con privilegios por defecto declarados, así que hay que
-- desactivarlos en los dos: quitarlo de uno solo deja la puerta del otro.
-- ---------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------
-- 2 · Y lo que ya existe se cierra también
-- ---------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Poder mirar el esquema sigue haciendo falta: sin esto no se llega ni a lo
-- que sí está concedido.
grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------
-- 3 · Las tablas, según lo que declaran sus políticas
--
-- El permiso abre la puerta; la política decide qué filas se ven al pasar. Las
-- dos cosas siguen haciendo falta, y ahora la primera dejó de ser gratis.
-- ---------------------------------------------------------------
grant select on public.app_settings to anon;
grant delete, insert, select, update on public.app_settings to authenticated;
grant select on public.banners to anon;
grant delete, insert, select, update on public.banners to authenticated;
grant select on public.business_modules to authenticated;
grant select on public.cash_movements to authenticated;
grant select on public.cash_sessions to authenticated;
grant select on public.catalog_categories to anon;
grant delete, insert, select, update on public.catalog_categories to authenticated;
grant select on public.categories to anon;
grant delete, insert, select, update on public.categories to authenticated;
grant delete, insert, select, update on public.coupon_categories to authenticated;
grant delete, insert, select, update on public.coupon_products to authenticated;
grant select on public.coupon_redemptions to authenticated;
grant delete, insert, select, update on public.coupons to authenticated;
grant delete, insert, select, update on public.couriers to authenticated;
grant delete, insert, select, update on public.customer_coupons to authenticated;
grant select on public.delivery_slots to anon;
grant delete, insert, select, update on public.delivery_slots to authenticated;
grant delete, insert, select, update on public.favorites to authenticated;
grant select on public.fiscal_documents to authenticated;
grant select on public.fiscal_series to authenticated;
grant select on public.money_audit to authenticated;
grant select on public.notifications to anon;
grant delete, insert, select, update on public.notifications to authenticated;
grant select on public.onboarding_slides to anon;
grant delete, insert, select, update on public.onboarding_slides to authenticated;
grant select on public.option_groups to anon;
grant delete, insert, select, update on public.option_groups to authenticated;
grant select on public.options to anon;
grant delete, insert, select, update on public.options to authenticated;
grant insert, select on public.order_events to authenticated;
grant delete, insert, select, update on public.order_items to authenticated;
grant select on public.order_payments to authenticated;
grant select on public.order_push_targets to authenticated;
grant select on public.order_transitions to authenticated;
grant insert, select, update on public.orders to authenticated;
grant delete, insert, select, update on public.payments to authenticated;
grant select on public.plans to anon;
grant delete, insert, select, update on public.plans to authenticated;
grant select on public.platform_commissions to authenticated;
grant select on public.platform_invoices to authenticated;
grant select on public.platform_settlements to authenticated;
grant select on public.products to anon;
grant delete, insert, select, update on public.products to authenticated;
grant delete, insert, select, update on public.profiles to authenticated;
grant select on public.push_subscriptions to authenticated;
grant select on public.ratings to anon;
grant insert, select, update on public.ratings to authenticated;
grant delete, insert, select, update on public.restaurant_couriers to authenticated;
grant delete, insert, select, update on public.restaurant_staff to authenticated;
grant select on public.restaurants to anon;
grant delete, insert, select, update on public.restaurants to authenticated;
grant select on public.reviews to anon;
grant delete, insert, select on public.reviews to authenticated;
grant select on public.sponsorship_offers to anon;
grant delete, insert, select, update on public.sponsorship_offers to authenticated;
grant delete, insert, select, update on public.sponsorships to authenticated;
grant delete, insert, select, update on public.staff_invitations to authenticated;
grant select on public.stock_movements to authenticated;
grant delete, insert, select, update on public.subscriptions to authenticated;
grant select on public.tables to anon;
grant delete, insert, select, update on public.tables to authenticated;
grant delete, insert, select, update on public.waiter_calls to authenticated;

-- Las secuencias que alimentan las columnas de identidad de esas tablas.
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------
-- 4 · Las funciones, una a una y con su firma
--
-- Se recorren por nombre y se concede sobre la firma concreta, porque hay
-- funciones con varias versiones y conceder por nombre a secas no sabría a
-- cuál referirse.
-- ---------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(array[
      'active_notifications',
      'available_delivery_slots',
      'call_waiter',
      'catalog_tree',
      'compute_coupon_discount',
      'courier_works_for',
      'delivery_allowed',
      'find_coupon',
      'get_order_by_token',
      'has_module',
      'has_staff_role',
      'home_banners',
      'home_categories',
      'invitation_preview',
      'is_courier',
      'is_staff_of',
      'is_superadmin',
      'list_cities',
      'my_courier_id',
      'nearest_city',
      'place_order',
      'restaurant_is_live',
      'restaurant_is_open_now',
      'sponsored_restaurants',
      'table_bill',
      'table_session_alive',
      'try_uuid',
      'unit_price_cents',
      'validate_coupon'
       ])
  loop
    execute format('grant execute on function %s to anon', f.firma);
  end loop;

  for f in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(array[
      'accept_staff_invitation',
      'activate_sponsorship',
      'active_notifications',
      'add_cash_movement',
      'add_order_payment',
      'adjust_stock',
      'apply_manual_discount',
      'assign_order_courier',
      'available_delivery_slots',
      'call_waiter',
      'can_cancel_orders',
      'can_charge',
      'cancel_order',
      'cancel_sponsorship',
      'cash_session_entries',
      'cash_session_report',
      'cash_sessions_list',
      'catalog_tree',
      'close_cash_session',
      'commission_rate_for',
      'compute_coupon_discount',
      'courier_can_use_pool',
      'courier_cash_due',
      'courier_complete_order',
      'courier_deliver_order',
      'courier_fail_delivery',
      'courier_picked_up',
      'courier_plan',
      'courier_stats',
      'courier_take_order',
      'courier_works_for',
      'current_cash_session',
      'delivery_allowed',
      'expected_cash',
      'find_coupon',
      'floor_status',
      'get_order_by_token',
      'has_module',
      'has_staff_role',
      'home_banners',
      'home_categories',
      'import_products',
      'invitation_preview',
      'is_courier',
      'is_staff_of',
      'is_superadmin',
      'issue_credit_note',
      'issue_fiscal_document',
      'issue_platform_invoice',
      'list_cities',
      'low_stock',
      'mark_order_paid',
      'merge_tables',
      'money_audit_list',
      'my_coupons',
      'my_courier_id',
      'nearest_city',
      'open_cash_session',
      'open_session_of',
      'order_documents',
      'order_picking_list',
      'order_rating_targets',
      'pay_table_bill',
      'pick_order_item',
      'place_order',
      'platform_account',
      'platform_revenue',
      'platform_stats',
      'refund_order',
      'replace_order_item',
      'reserve_sponsorship',
      'restaurant_analytics',
      'restaurant_cash_due',
      'restaurant_couriers_available',
      'restaurant_is_live',
      'restaurant_is_open_now',
      'restaurant_stats',
      'set_order_covers',
      'settle_courier_cash',
      'settle_platform_commissions',
      'shares_restaurant_with',
      'sponsored_restaurants',
      'sponsorship_availability',
      'table_bill',
      'table_session_alive',
      'transfer_order_to_table',
      'try_uuid',
      'unit_price_cents',
      'validate_coupon',
      'void_order_item'
       ])
  loop
    execute format('grant execute on function %s to authenticated', f.firma);
  end loop;
end $$;
