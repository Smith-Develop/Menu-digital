-- =============================================================
--  Fase D · dar de alta el catálogo entero de una vez
--
--  Una carta se teclea: doce platos, veinte como mucho, y se hace una tarde. Un
--  supermercado tiene miles de referencias y ya las tiene escritas en alguna
--  parte —el programa anterior, el mayorista, una hoja de cálculo—. Pedirle que
--  las vuelva a teclear una por una es pedirle que no use la aplicación.
--
--  Esto recibe la lista ya leída y la mete de golpe, con dos cuidados. El
--  primero es que se pueda mirar antes de tocar nada: `p_dry_run` calcula el
--  mismo informe sin escribir, para que quien importa vea cuántas se crean,
--  cuántas se actualizan y qué filas están mal antes de decidir.
--
--  El segundo es que una fila mala no tumbe el fichero. Un pasillo que no
--  existe no puede costar ochocientas referencias: el producto entra sin
--  categoría y el informe dice qué pasillos no reconoció, que es lo accionable.
--  Lo que sí detiene la importación es quedarse sin sitio en el plan, porque
--  entrar a medias deja un catálogo que no es ni el viejo ni el nuevo.
-- =============================================================

create or replace function public.import_products(
  p_restaurant_id uuid,
  p_rows          jsonb,
  p_dry_run       boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila      jsonb;
  v_i         int := 0;
  v_nombre    text;
  v_codigo    text;
  v_precio    int;
  v_unidad    text;
  v_cat_txt   text;
  v_cat_id    uuid;
  v_existente public.products;
  v_creadas   int := 0;
  v_actual    int := 0;
  v_malas     jsonb := '[]'::jsonb;
  v_pasillos  text[] := '{}';
  v_sin_cat   int := 0;
  v_tope      int;
  v_ahora     int;
begin
  if not public.is_staff_of(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Cuántas caben. El plan del local manda; sin plan, no hay tope.
  select p.max_products into v_tope
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
   where s.restaurant_id = p_restaurant_id
   order by s.current_period_end desc
   limit 1;

  select count(*) into v_ahora from public.products where restaurant_id = p_restaurant_id;

  for v_fila in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;

    v_nombre := nullif(btrim(coalesce(v_fila->>'name', '')), '');
    v_codigo := nullif(btrim(coalesce(v_fila->>'barcode', '')), '');

    if v_nombre is null then
      v_malas := v_malas || jsonb_build_object('row', v_i, 'code', 'NAME_REQUIRED');
      continue;
    end if;

    begin
      v_precio := (v_fila->>'price_cents')::int;
    exception when others then
      v_precio := null;
    end;

    if v_precio is null or v_precio < 0 then
      v_malas := v_malas || jsonb_build_object('row', v_i, 'code', 'PRICE_REQUIRED', 'name', v_nombre);
      continue;
    end if;

    -- Una unidad que no reconocemos no es motivo para perder la fila: se vende
    -- por unidades, que es lo que hace la inmensa mayoría.
    v_unidad := lower(coalesce(v_fila->>'unit', 'unit'));
    if v_unidad not in ('unit', 'kg', 'g', 'l', 'ml') then v_unidad := 'unit'; end if;

    -- El pasillo, por identificador o por nombre, como venga escrito.
    v_cat_id  := null;
    v_cat_txt := nullif(btrim(coalesce(v_fila->>'category', '')), '');
    if v_cat_txt is not null then
      select c.id into v_cat_id
        from public.catalog_categories c
       where c.is_active
         and (c.slug = lower(v_cat_txt) or lower(c.name) = lower(v_cat_txt))
       limit 1;

      if v_cat_id is null then
        v_sin_cat := v_sin_cat + 1;
        if not (v_cat_txt = any(v_pasillos)) then
          v_pasillos := v_pasillos || v_cat_txt;
        end if;
      end if;
    end if;

    -- ¿Ya la tenemos? El código de barras identifica de verdad; el nombre es lo
    -- que queda cuando el fichero no lo trae.
    v_existente := null;
    if v_codigo is not null then
      select * into v_existente from public.products
       where restaurant_id = p_restaurant_id and barcode = v_codigo limit 1;
    end if;
    if v_existente.id is null then
      select * into v_existente from public.products
       where restaurant_id = p_restaurant_id and lower(name) = lower(v_nombre) limit 1;
    end if;

    if v_existente.id is null then
      -- Quedarse sin sitio a mitad deja un catálogo que no es ni el viejo ni el
      -- nuevo: mejor parar y decir cuántas caben.
      if v_tope is not null and v_ahora + v_creadas >= v_tope then
        return jsonb_build_object(
          'ok', false, 'error', 'PLAN_LIMIT_PRODUCTS',
          'max', v_tope, 'current', v_ahora, 'row', v_i);
      end if;
      v_creadas := v_creadas + 1;
    else
      v_actual := v_actual + 1;
    end if;

    continue when p_dry_run;

    if v_existente.id is null then
      insert into public.products (
        restaurant_id, catalog_category_id, name, description, price_cents,
        image_url, unit, brand, pack_size, barcode, net_content, sold_by_weight,
        tax_rate, track_stock, stock_qty, is_available, position
      ) values (
        p_restaurant_id, v_cat_id, v_nombre,
        nullif(btrim(coalesce(v_fila->>'description', '')), ''), v_precio,
        nullif(btrim(coalesce(v_fila->>'image_url', '')), ''),
        v_unidad::sale_unit,
        nullif(btrim(coalesce(v_fila->>'brand', '')), ''),
        nullif(btrim(coalesce(v_fila->>'pack_size', '')), ''),
        v_codigo,
        nullif(v_fila->>'net_content', '')::numeric,
        coalesce((v_fila->>'sold_by_weight')::boolean, false),
        nullif(v_fila->>'tax_rate', '')::numeric,
        coalesce((v_fila->>'track_stock')::boolean, false),
        coalesce(nullif(v_fila->>'stock_qty', '')::int, 0),
        coalesce((v_fila->>'is_available')::boolean, true),
        v_i
      );
    else
      -- Actualizar respeta lo que el fichero no trae: una columna ausente no
      -- borra lo que ya había puesto alguien a mano.
      update public.products set
        name        = v_nombre,
        price_cents = v_precio,
        unit        = v_unidad::sale_unit,
        catalog_category_id = coalesce(v_cat_id, catalog_category_id),
        description = coalesce(nullif(btrim(coalesce(v_fila->>'description','')), ''), description),
        image_url   = coalesce(nullif(btrim(coalesce(v_fila->>'image_url','')), ''), image_url),
        brand       = coalesce(nullif(btrim(coalesce(v_fila->>'brand','')), ''), brand),
        pack_size   = coalesce(nullif(btrim(coalesce(v_fila->>'pack_size','')), ''), pack_size),
        barcode     = coalesce(v_codigo, barcode),
        net_content = coalesce(nullif(v_fila->>'net_content','')::numeric, net_content),
        tax_rate    = coalesce(nullif(v_fila->>'tax_rate','')::numeric, tax_rate),
        track_stock = coalesce((v_fila->>'track_stock')::boolean, track_stock),
        stock_qty   = coalesce(nullif(v_fila->>'stock_qty','')::int, stock_qty),
        is_available = coalesce((v_fila->>'is_available')::boolean, is_available),
        sold_by_weight = coalesce((v_fila->>'sold_by_weight')::boolean, sold_by_weight),
        updated_at  = now()
      where id = v_existente.id;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'created', v_creadas,
    'updated', v_actual,
    'failed', jsonb_array_length(v_malas),
    'errors', v_malas,
    'without_category', v_sin_cat,
    'unknown_categories', to_jsonb(v_pasillos));
end;
$$;

grant execute on function public.import_products(uuid, jsonb, boolean) to authenticated;
