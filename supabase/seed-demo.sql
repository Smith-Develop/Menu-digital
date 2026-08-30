-- =============================================================
--  Menu Digital · restaurante de demostración
--
--  Las contraseñas llegan como marcadores __ADMIN_PW__, __OWNER_PW__,
--  __KITCHEN_PW__ y __COURIER_PW__ que scripts/seed-demo.py sustituye desde
--  el entorno,
--  para que este archivo pueda vivir en el repositorio sin secretos.
--  Es idempotente: si el restaurante ya existe, no hace nada.
-- =============================================================
do $$
declare
  v_admin_id    uuid := gen_random_uuid();
  v_owner_id    uuid := gen_random_uuid();
  v_kitchen_id  uuid := gen_random_uuid();
  v_rest_id     uuid;
  v_plan_id     uuid;
  v_cat_pizza   uuid;
  v_cat_pasta   uuid;
  v_cat_burger  uuid;
  v_cat_drinks  uuid;
  v_product     uuid;
  v_group       uuid;
  v_table       record;
  v_courier_user uuid;
  v_courier_id   uuid;
begin
  if exists (select 1 from public.restaurants where slug = 'la-trattoria') then
    raise notice 'El seed de demostración ya estaba aplicado.';
    return;
  end if;

  -- ---------- Cuentas ----------
  if not exists (select 1 from auth.users where email = 'admin@menudigital.app') then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated',
            'admin@menudigital.app', crypt('__ADMIN_PW__', gen_salt('bf')),
            now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{"full_name":"Super Admin","role":"superadmin"}'::jsonb, '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_admin_id, v_admin_id::text,
            jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@menudigital.app', 'email_verified', true),
            'email', now(), now(), now());

    update public.profiles set role = 'superadmin', full_name = 'Super Admin' where id = v_admin_id;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000000', v_owner_id, 'authenticated', 'authenticated',
     'owner@latrattoria.app', crypt('__OWNER_PW__', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Marco Rossi","role":"restaurant"}'::jsonb, '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_kitchen_id, 'authenticated', 'authenticated',
     'cocina@latrattoria.app', crypt('__KITCHEN_PW__', gen_salt('bf')), now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Equipo de cocina","role":"restaurant"}'::jsonb, '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                               last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), v_owner_id, v_owner_id::text,
     jsonb_build_object('sub', v_owner_id::text, 'email', 'owner@latrattoria.app', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), v_kitchen_id, v_kitchen_id::text,
     jsonb_build_object('sub', v_kitchen_id::text, 'email', 'cocina@latrattoria.app', 'email_verified', true),
     'email', now(), now(), now());

  update public.profiles set role = 'restaurant' where id in (v_owner_id, v_kitchen_id);

  -- ---------- Restaurante ----------
  insert into public.restaurants (
    owner_id, slug, name, description, logo_url, cover_url, phone, email,
    address, city, country, currency, currency_decimals, locale, timezone,
    cuisine_tags, rating, rating_count, avg_prep_minutes,
    delivery_fee_cents, min_order_cents, tax_rate, is_active, is_open)
  values (
    v_owner_id, 'la-trattoria', 'La Trattoria',
    'Cocina italiana de barrio. Masa madre de 48 horas, pasta fresca cada mañana y horno de leña.',
    'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=200&h=200&fit=crop',
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&h=600&fit=crop',
    '+34 910 123 456', 'hola@latrattoria.app',
    'Calle Mayor 24, Madrid', 'Madrid', 'ES', 'EUR', 2, 'es', 'Europe/Madrid',
    array['Italiana','Pizza','Pasta'], 4.7, 218, 25,
    290, 1200, 0.10, true, true)
  returning id into v_rest_id;

  insert into public.restaurant_staff (restaurant_id, user_id, role)
  values (v_rest_id, v_owner_id, 'owner'),
         (v_rest_id, v_kitchen_id, 'kitchen');

  -- Suscripción Pro activa durante un mes.
  select id into v_plan_id from public.plans where name = 'Pro' limit 1;
  insert into public.subscriptions (restaurant_id, plan_id, status, current_period_start,
                                    current_period_end, assigned_by)
  values (v_rest_id, v_plan_id, 'active', now(), now() + interval '30 days', v_admin_id);

  -- ---------- Carta ----------
  insert into public.categories (restaurant_id, name, description, image_url, position)
  values (v_rest_id, 'Pizzas', 'Horno de leña, masa de 48 horas',
          'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=200&h=200&fit=crop', 1)
  returning id into v_cat_pizza;

  insert into public.categories (restaurant_id, name, description, image_url, position)
  values (v_rest_id, 'Pastas', 'Pasta fresca elaborada cada mañana',
          'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=200&h=200&fit=crop', 2)
  returning id into v_cat_pasta;

  insert into public.categories (restaurant_id, name, description, image_url, position)
  values (v_rest_id, 'Hamburguesas', 'Carne madurada y pan brioche',
          'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&h=200&fit=crop', 3)
  returning id into v_cat_burger;

  insert into public.categories (restaurant_id, name, description, image_url, position)
  values (v_rest_id, 'Bebidas', 'Refrescos, vinos y cervezas',
          'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=200&h=200&fit=crop', 4)
  returning id into v_cat_drinks;

  -- Pizza Margherita: con tamaños, extras y modelo 3D.
  insert into public.products (restaurant_id, category_id, name, description, price_cents,
                               image_url, model_3d_url, prep_minutes, calories,
                               ingredients, allergens, tags, rating, rating_count, is_featured, position)
  values (v_rest_id, v_cat_pizza, 'Pizza Margherita',
          'Tomate San Marzano, mozzarella fior di latte, albahaca fresca y aceite de oliva virgen extra.',
          950, 'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=800&h=600&fit=crop',
          'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Avocado/glTF-Binary/Avocado.glb',
          18, 780, array['Tomate','Mozzarella','Albahaca','Aceite de oliva'],
          array['Gluten','Lácteos'], array['vegetariana'], 4.8, 96, true, 1)
  returning id into v_product;

  insert into public.option_groups (product_id, name, min_select, max_select, is_required, position)
  values (v_product, 'Tamaño', 1, 1, true, 1) returning id into v_group;
  insert into public.options (group_id, name, price_delta_cents, is_default, position) values
    (v_group, '26 cm', 0, true, 1),
    (v_group, '33 cm', 300, false, 2),
    (v_group, '40 cm', 600, false, 3);

  insert into public.option_groups (product_id, name, min_select, max_select, is_required, position)
  values (v_product, 'Extras', 0, 4, false, 2) returning id into v_group;
  insert into public.options (group_id, name, price_delta_cents, position) values
    (v_group, 'Extra mozzarella', 150, 1),
    (v_group, 'Rúcula', 100, 2),
    (v_group, 'Jamón ibérico', 350, 3),
    (v_group, 'Champiñones', 120, 4);

  insert into public.products (restaurant_id, category_id, name, description, price_cents,
                               image_url, prep_minutes, calories, ingredients, allergens,
                               rating, rating_count, is_featured, position)
  values
    (v_rest_id, v_cat_pizza, 'Pizza Diavola',
     'Salami picante, mozzarella, tomate y un toque de miel.', 1250,
     'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&h=600&fit=crop',
     18, 940, array['Salami picante','Mozzarella','Tomate','Miel'], array['Gluten','Lácteos'], 4.6, 74, true, 2),
    (v_rest_id, v_cat_pizza, 'Pizza Quattro Formaggi',
     'Mozzarella, gorgonzola, parmesano y provolone.', 1350,
     'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?w=800&h=600&fit=crop',
     18, 1020, array['Mozzarella','Gorgonzola','Parmesano','Provolone'], array['Gluten','Lácteos'], 4.5, 52, false, 3),
    (v_rest_id, v_cat_pasta, 'Tagliatelle al ragú',
     'Ragú de ternera cocinado ocho horas a fuego lento.', 1390,
     'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=800&h=600&fit=crop',
     20, 860, array['Pasta fresca','Ternera','Tomate','Parmesano'], array['Gluten','Huevo','Lácteos'], 4.9, 131, true, 4),
    (v_rest_id, v_cat_pasta, 'Carbonara romana',
     'Guanciale, pecorino, huevo y pimienta negra. Sin nata.', 1290,
     'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=800&h=600&fit=crop',
     16, 910, array['Guanciale','Pecorino','Huevo','Pimienta'], array['Gluten','Huevo','Lácteos'], 4.7, 88, false, 5),
    (v_rest_id, v_cat_burger, 'Trattoria Burger',
     'Doble de vaca madurada, provolone, cebolla caramelizada y pan brioche.', 1450,
     'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=600&fit=crop',
     15, 1120, array['Vaca madurada','Provolone','Cebolla','Pan brioche'], array['Gluten','Lácteos','Sésamo'], 4.6, 64, true, 6),
    (v_rest_id, v_cat_drinks, 'Limonada casera',
     'Limón exprimido, menta fresca y agua con gas.', 350,
     'https://images.unsplash.com/photo-1621263764928-df1444c5e859?w=800&h=600&fit=crop',
     3, 90, array['Limón','Menta','Agua con gas'], array[]::text[], 4.4, 30, false, 7),
    (v_rest_id, v_cat_drinks, 'Copa de Chianti',
     'DOCG, cosecha 2021.', 490,
     'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=800&h=600&fit=crop',
     2, 120, array['Uva Sangiovese'], array['Sulfitos'], 4.3, 21, false, 8);

  -- ---------- Repartidor de ejemplo ----------
  -- Se da de alta como repartidor y queda vinculado al restaurante: así se
  -- puede probar el circuito completo listo → aceptar → entregado.
  if not exists (select 1 from auth.users where email = 'repartidor@yumi.app') then
    v_courier_user := gen_random_uuid();

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_courier_user, 'authenticated', 'authenticated',
            'repartidor@yumi.app', crypt('__COURIER_PW__', gen_salt('bf')), now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{"full_name":"Luis Reparto","role":"courier"}'::jsonb, '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_courier_user, v_courier_user::text,
            jsonb_build_object('sub', v_courier_user::text, 'email', 'repartidor@yumi.app',
                               'email_verified', true),
            'email', now(), now(), now());

    update public.profiles set role = 'courier' where id = v_courier_user;

    insert into public.couriers (user_id, phone, vehicle, status, city)
    values (v_courier_user, '+34 611 222 333', 'moto', 'available', 'Madrid')
    returning id into v_courier_id;

    insert into public.restaurant_couriers (restaurant_id, courier_id)
    values (v_rest_id, v_courier_id);
  end if;

  -- ---------- Mesas ----------
  for v_table in
    select * from (values
      ('Mesa 1', 'Salón', 2), ('Mesa 2', 'Salón', 4), ('Mesa 3', 'Salón', 4),
      ('Mesa 4', 'Salón', 6), ('Mesa 5', 'Terraza', 2), ('Mesa 6', 'Terraza', 4),
      ('Mesa 7', 'Terraza', 4), ('Barra 1', 'Barra', 1)
    ) as v(name, zone, seats)
  loop
    insert into public.tables (restaurant_id, code, name, zone, seats)
    values (v_rest_id,
            'LATRAT-' || upper(replace(public.slugify(v_table.name), '-', '')) || '-' ||
              upper(substr(md5(gen_random_uuid()::text), 1, 4)),
            v_table.name, v_table.zone, v_table.seats);
  end loop;

  raise notice 'Restaurante de demostración creado: %', v_rest_id;
end $$;
