-- =============================================================
--  Yumi · restaurantes de ejemplo en varias ciudades + banners
--  Sirve para comprobar el filtrado por ciudad de la portada.
-- =============================================================
do $$
declare
  v_rest   uuid;
  v_cat    uuid;
  v_plan   uuid;
  v_row    record;
begin
  -- La Trattoria ya existía: le damos coordenadas y un banner.
  update public.restaurants
     set lat = 40.4168, lng = -3.7038
   where slug = 'la-trattoria' and lat is null;

  select id into v_plan from public.plans where name = 'Pro' limit 1;

  for v_row in
    select * from (values
      ('sushi-ya', 'Sushi Ya', 'Barra de sushi con pescado de lonja diaria y arroz templado al momento.',
       'Madrid', 40.4260, -3.6990,
       'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=1200&h=600&fit=crop',
       'https://images.unsplash.com/photo-1553621042-f6e147245754?w=200&h=200&fit=crop',
       array['Japonesa','Sushi'], 4.6, 143,
       'Sushi', 'Nigiri variado', 'Ocho piezas de nigiri con pescado del día.', 1890,
       'https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=800&h=600&fit=crop'),

      ('el-asador', 'El Asador', 'Brasas de encina, chuletón madurado y verduras de temporada.',
       'Madrid', 40.4090, -3.6920,
       'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=1200&h=600&fit=crop',
       'https://images.unsplash.com/photo-1544025162-d76694265947?w=200&h=200&fit=crop',
       array['Carnes','Parrilla'], 4.8, 267,
       'Carnes', 'Chuletón de vaca madurado', 'Madurado 45 días, servido al punto sobre piedra.', 3200,
       'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=800&h=600&fit=crop'),

      ('bombeta', 'Bombeta Barcelona', 'Tapas catalanas de toda la vida en el corazón de la Barceloneta.',
       'Barcelona', 41.3809, 2.1892,
       'https://images.unsplash.com/photo-1515443961218-a51367888e4b?w=1200&h=600&fit=crop',
       'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=200&h=200&fit=crop',
       array['Tapas','Mediterránea'], 4.5, 189,
       'Tapas', 'Bomba de la Barceloneta', 'Patata rellena de carne con brava y alioli.', 450,
       'https://images.unsplash.com/photo-1541529086526-db283c563270?w=800&h=600&fit=crop'),

      ('can-paella', 'Can Paella', 'Arroces valencianos a leña, con la socarrat en su punto.',
       'Valencia', 39.4699, -0.3763,
       'https://images.unsplash.com/photo-1534080564583-6be75777b70a?w=1200&h=600&fit=crop',
       'https://images.unsplash.com/photo-1523986371872-9d3ba2e2a389?w=200&h=200&fit=crop',
       array['Arroces','Valenciana'], 4.9, 312,
       'Arroces', 'Paella valenciana', 'Pollo, conejo, garrofó y ferradura. Mínimo dos personas.', 2400,
       'https://images.unsplash.com/photo-1534080564583-6be75777b70a?w=800&h=600&fit=crop')
    ) as v(slug, name, description, city, lat, lng, cover, logo, tags, rating, rating_count,
           cat_name, dish_name, dish_desc, dish_price, dish_img)
  loop
    continue when exists (select 1 from public.restaurants where slug = v_row.slug);

    insert into public.restaurants (
      slug, name, description, logo_url, cover_url, phone, address, city, country,
      lat, lng, currency, currency_decimals, cuisine_tags, rating, rating_count,
      avg_prep_minutes, delivery_fee_cents, min_order_cents, tax_rate, is_active, is_open)
    values (
      v_row.slug, v_row.name, v_row.description, v_row.logo, v_row.cover,
      '+34 900 000 000', 'Calle Ejemplo 1', v_row.city, 'ES',
      v_row.lat, v_row.lng, 'EUR', 2, v_row.tags, v_row.rating, v_row.rating_count,
      25, 250, 1000, 0.10, true, true)
    returning id into v_rest;

    insert into public.subscriptions (restaurant_id, plan_id, status, current_period_start, current_period_end)
    values (v_rest, v_plan, 'active', now(), now() + interval '30 days');

    insert into public.categories (restaurant_id, name, position)
    values (v_rest, v_row.cat_name, 1) returning id into v_cat;

    insert into public.products (restaurant_id, category_id, name, description, price_cents,
                                 image_url, prep_minutes, rating, rating_count, is_featured, position)
    values (v_rest, v_cat, v_row.dish_name, v_row.dish_desc, v_row.dish_price,
            v_row.dish_img, 20, v_row.rating, 40, true, 1);

    insert into public.banners (restaurant_id, title, subtitle, image_url, link_url, position)
    values (v_rest,
            v_row.name,
            'Pide hoy y recíbelo en 25 minutos',
            v_row.cover,
            '/r/' || v_row.slug,
            1);
  end loop;

  -- Banner de La Trattoria
  select id into v_rest from public.restaurants where slug = 'la-trattoria';
  if v_rest is not null and not exists (select 1 from public.banners where restaurant_id = v_rest) then
    insert into public.banners (restaurant_id, title, subtitle, image_url, link_url, position)
    values (v_rest, 'La Trattoria', 'Pasta fresca cada mañana · 2x1 en pizzas los martes',
            'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200&h=600&fit=crop',
            '/r/la-trattoria', 1);
  end if;
end $$;
