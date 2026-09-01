-- =============================================================
--  Fase D · la importación decide antes de escribir
--
--  La versión anterior comprobaba el tope del plan dentro del mismo bucle que
--  daba de alta, y devolvía el error al llegar a la referencia que ya no cabía.
--  Para entonces las anteriores estaban escritas: una función de plpgsql no es
--  una transacción propia, así que `return` no deshace nada. El resultado era
--  justo lo que la función decía evitar —un catálogo a medias, ni el viejo ni
--  el nuevo— y encima lo decía en un comentario, que es la peor forma de estar
--  equivocado.
--
--  Ahora va en dos tiempos dentro de la misma llamada: primero se resuelve el
--  fichero entero sin tocar la tabla —qué fila es nueva, cuál existe, cuál no
--  se entiende— y se decide si cabe; sólo si cabe se escribe. El ensayo en seco
--  deja de ser un modo aparte y pasa a ser el primer tiempo, que es lo que
--  siempre fue.
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
  v_id        uuid;
  v_creadas   int := 0;
  v_actual    int := 0;
  v_malas     jsonb := '[]'::jsonb;
  v_plan      jsonb := '[]'::jsonb;   -- lo resuelto, listo para escribirse
  v_pasillos  text[] := '{}';
  v_sin_cat   int := 0;
  v_tope      int;
  v_ahora     int;
  v_paso      jsonb;
begin
  if not public.is_staff_of(p_restaurant_id) and not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.max_products into v_tope
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
   where s.restaurant_id = p_restaurant_id
   order by s.current_period_end desc
   limit 1;

  select count(*) into v_ahora from public.products where restaurant_id = p_restaurant_id;

  -- ------------------------------------------------------------------
  -- Primer tiempo: entender el fichero. No se escribe nada aquí.
  -- ------------------------------------------------------------------
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

    -- El pasillo, por identificador o por nombre, como venga escrito. Uno que
    -- no existe no puede costar ochocientas referencias: entran sin pasillo y
    -- el informe dice cuáles no reconoció, que es lo accionable.
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
    v_id := null;
    if v_codigo is not null then
      select id into v_id from public.products
       where restaurant_id = p_restaurant_id and barcode = v_codigo limit 1;
    end if;
    if v_id is null then
      select id into v_id from public.products
       where restaurant_id = p_restaurant_id and lower(name) = lower(v_nombre) limit 1;
    end if;

    if v_id is null then v_creadas := v_creadas + 1; else v_actual := v_actual + 1; end if;

    v_plan := v_plan || jsonb_build_object(
      'id', v_id, 'row', v_i, 'name', v_nombre, 'price_cents', v_precio,
      'unit', v_unidad, 'barcode', v_codigo, 'category_id', v_cat_id, 'raw', v_fila);
  end loop;

  -- ------------------------------------------------------------------
  -- La decisión, con el fichero entero ya entendido y la tabla intacta.
  -- ------------------------------------------------------------------
  if v_tope is not null and v_ahora + v_creadas > v_tope then
    return jsonb_build_object(
      'ok', false, 'error', 'PLAN_LIMIT_PRODUCTS',
      'max', v_tope, 'current', v_ahora, 'would_create', v_creadas);
  end if;

  -- ------------------------------------------------------------------
  -- Segundo tiempo: escribir. Ya no puede fallar por sitio.
  -- ------------------------------------------------------------------
  if not p_dry_run then
    for v_paso in select * from jsonb_array_elements(v_plan) loop
      v_fila := v_paso->'raw';

      if v_paso->>'id' is null then
        insert into public.products (
          restaurant_id, catalog_category_id, name, description, price_cents,
          image_url, unit, brand, pack_size, barcode, net_content, sold_by_weight,
          tax_rate, track_stock, stock_qty, is_available, position
        ) values (
          p_restaurant_id, (v_paso->>'category_id')::uuid, v_paso->>'name',
          nullif(btrim(coalesce(v_fila->>'description', '')), ''),
          (v_paso->>'price_cents')::int,
          nullif(btrim(coalesce(v_fila->>'image_url', '')), ''),
          (v_paso->>'unit')::sale_unit,
          nullif(btrim(coalesce(v_fila->>'brand', '')), ''),
          nullif(btrim(coalesce(v_fila->>'pack_size', '')), ''),
          v_paso->>'barcode',
          nullif(v_fila->>'net_content', '')::numeric,
          coalesce((v_fila->>'sold_by_weight')::boolean, false),
          nullif(v_fila->>'tax_rate', '')::numeric,
          coalesce((v_fila->>'track_stock')::boolean, false),
          coalesce(nullif(v_fila->>'stock_qty', '')::int, 0),
          coalesce((v_fila->>'is_available')::boolean, true),
          (v_paso->>'row')::int
        );
      else
        -- Actualizar respeta lo que el fichero no trae: una columna ausente no
        -- borra lo que ya había puesto alguien a mano.
        update public.products set
          name        = v_paso->>'name',
          price_cents = (v_paso->>'price_cents')::int,
          unit        = (v_paso->>'unit')::sale_unit,
          catalog_category_id = coalesce((v_paso->>'category_id')::uuid, catalog_category_id),
          description = coalesce(nullif(btrim(coalesce(v_fila->>'description','')), ''), description),
          image_url   = coalesce(nullif(btrim(coalesce(v_fila->>'image_url','')), ''), image_url),
          brand       = coalesce(nullif(btrim(coalesce(v_fila->>'brand','')), ''), brand),
          pack_size   = coalesce(nullif(btrim(coalesce(v_fila->>'pack_size','')), ''), pack_size),
          barcode     = coalesce(v_paso->>'barcode', barcode),
          net_content = coalesce(nullif(v_fila->>'net_content','')::numeric, net_content),
          tax_rate    = coalesce(nullif(v_fila->>'tax_rate','')::numeric, tax_rate),
          track_stock = coalesce((v_fila->>'track_stock')::boolean, track_stock),
          stock_qty   = coalesce(nullif(v_fila->>'stock_qty','')::int, stock_qty),
          is_available = coalesce((v_fila->>'is_available')::boolean, is_available),
          sold_by_weight = coalesce((v_fila->>'sold_by_weight')::boolean, sold_by_weight),
          updated_at  = now()
        where id = (v_paso->>'id')::uuid;
      end if;
    end loop;
  end if;

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
