-- =============================================================
--  Menu Digital · planes de suscripción iniciales
-- =============================================================
insert into public.plans (name, description, interval, price_cents, currency, trial_days,
                          max_tables, max_products, max_staff, allows_3d, allows_delivery, features, position)
select * from (values
  ('Starter', 'Carta digital con QR para locales pequeños', 'month'::plan_interval, 1900, 'EUR'::char(3), 14,
   10, 50, 3, false, true,
   '["Carta digital ilimitada","QR por mesa","Pedidos en mesa","Pantalla de cocina"]'::jsonb, 1),
  ('Starter anual', 'Dos meses gratis frente al plan mensual', 'year'::plan_interval, 19000, 'EUR'::char(3), 14,
   10, 50, 3, false, true,
   '["Todo lo del plan Starter","2 meses gratis"]'::jsonb, 2),
  ('Pro', 'Para restaurantes con reparto propio y platos en 3D', 'month'::plan_interval, 4900, 'EUR'::char(3), 14,
   40, 300, 15, true, true,
   '["Todo lo del plan Starter","Modelos 3D y realidad aumentada","Pedidos a domicilio","Gestión de equipo","Estadísticas avanzadas"]'::jsonb, 3),
  ('Pro anual', 'El plan Pro con dos meses gratis', 'year'::plan_interval, 49000, 'EUR'::char(3), 14,
   40, 300, 15, true, true,
   '["Todo lo del plan Pro","2 meses gratis"]'::jsonb, 4),
  ('Enterprise', 'Cadenas y grupos de restauración, sin límites', 'month'::plan_interval, 9900, 'EUR'::char(3), 0,
   null::int, null::int, null::int, true, true,
   '["Mesas, platos y empleados ilimitados","Soporte prioritario","Dominio propio"]'::jsonb, 5)
) as v(name, description, interval, price_cents, currency, trial_days,
       max_tables, max_products, max_staff, allows_3d, allows_delivery, features, position)
where not exists (select 1 from public.plans p where p.name = v.name);
