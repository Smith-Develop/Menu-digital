-- =============================================================
--  Fase C · las facturas de la plataforma a sus clientes
--
--  Los locales pagan y necesitan su factura. La numeración por serie ya está
--  construida para los pedidos, pero aquella tiene al restaurante como emisor:
--  aquí el emisor es la plataforma, que hasta ahora no tenía identidad fiscal
--  en ninguna parte —`app_settings` guarda nombre, logotipo y colores, y nada
--  más—. Emitir una factura sin emisor no es emitir una factura.
-- =============================================================

alter table public.app_settings
  add column if not exists legal_name    text,
  add column if not exists tax_id        text,
  add column if not exists fiscal_address text,
  add column if not exists invoice_series text not null default 'P',
  add column if not exists invoice_next  bigint not null default 1,
  add column if not exists invoice_note  text;

comment on column public.app_settings.tax_id is
  'Identificación fiscal de la plataforma. Sin ella no se puede emitir factura.';

-- ---------------------------------------------------------------
-- Las facturas que la plataforma emite a sus clientes
-- ---------------------------------------------------------------
create table if not exists public.platform_invoices (
  id            uuid primary key default gen_random_uuid(),

  subject_type  subscription_subject not null,
  subject_id    uuid not null,
  -- El concepto: una cuota, una liquidación de comisiones, o ambas.
  subscription_id uuid references public.subscriptions(id) on delete set null,
  settlement_id   uuid references public.platform_settlements(id) on delete set null,

  number        bigint not null,
  full_number   text not null unique,
  issued_at     timestamptz not null default now(),
  issued_by     uuid references public.profiles(id) on delete set null,

  -- Congelado, igual que en las facturas de los pedidos: un documento entregado
  -- no puede cambiar porque cambien los ajustes de la plataforma.
  issuer_name     text not null,
  issuer_tax_id   text,
  issuer_address  text,
  customer_name   text not null,
  customer_tax_id text,
  customer_address text,

  currency      char(3) not null default 'EUR',
  subtotal_cents integer not null default 0,
  tax_rate      numeric(5,4) not null default 0,
  tax_cents     integer not null default 0,
  total_cents   integer not null default 0,
  lines         jsonb not null default '[]'::jsonb,
  note          text,

  created_at    timestamptz not null default now()
);

create index if not exists platform_invoices_subject_idx
  on public.platform_invoices (subject_type, subject_id, issued_at desc);

/** Una factura emitida no se toca. Si está mal, se rectifica con otra. */
create or replace function public.platform_invoices_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'INVOICE_IMMUTABLE' using errcode = '42501';
end $$;

drop trigger if exists platform_invoices_no_update on public.platform_invoices;
create trigger platform_invoices_no_update
  before update or delete on public.platform_invoices
  for each row execute function public.platform_invoices_immutable();

/**
 * Emite la factura de una liquidación de comisiones.
 *
 * Es el caso que ya se puede facturar hoy: la liquidación existe, tiene importe
 * y tiene fecha. Las cuotas se facturarán igual cuando pasen por Stripe, con la
 * misma serie y la misma función de numerar.
 */
create or replace function public.issue_platform_invoice(
  p_settlement_id uuid,
  p_tax_rate      numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set   public.platform_settlements;
  v_cfg   public.app_settings;
  v_num   bigint;
  v_full  text;
  v_id    uuid;
  v_nombre text;
  v_nif    text;
  v_dir    text;
  v_base   int;
  v_tax    int;
  v_ya     public.platform_invoices;
begin
  if not public.is_superadmin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_set from public.platform_settlements where id = p_settlement_id;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_ya from public.platform_invoices where settlement_id = p_settlement_id limit 1;
  if found then
    return jsonb_build_object('ok', true, 'already', true,
                              'id', v_ya.id, 'full_number', v_ya.full_number);
  end if;

  select * into v_cfg from public.app_settings where id;

  -- Sin identificación fiscal del emisor no hay factura que valga: mejor
  -- negarse que emitir un documento que no sirve.
  if coalesce(btrim(coalesce(v_cfg.tax_id, '')), '') = '' then
    raise exception 'PLATFORM_TAX_ID_MISSING' using errcode = 'P0001';
  end if;

  -- Datos del cliente, según sea un negocio o una persona.
  if v_set.subject_type = 'restaurant' then
    select r.name, r.document_number, r.address into v_nombre, v_nif, v_dir
      from public.restaurants r where r.id = v_set.subject_id;
  else
    select coalesce(pr.full_name, pr.email), null, null into v_nombre, v_nif, v_dir
      from public.couriers c join public.profiles pr on pr.id = c.user_id
     where c.id = v_set.subject_id;
  end if;

  -- Numeración correlativa propia de la plataforma, con su serie.
  update public.app_settings
     set invoice_next = invoice_next + 1
   where id
  returning invoice_next - 1 into v_num;

  v_full := coalesce(nullif(v_cfg.invoice_series, ''), 'P') || '-' || lpad(v_num::text, 6, '0');

  v_base := v_set.amount_cents;
  v_tax  := round(v_base * coalesce(p_tax_rate, 0))::int;

  insert into public.platform_invoices (
    subject_type, subject_id, settlement_id, number, full_number, issued_by,
    issuer_name, issuer_tax_id, issuer_address,
    customer_name, customer_tax_id, customer_address,
    currency, subtotal_cents, tax_rate, tax_cents, total_cents, lines, note
  ) values (
    v_set.subject_type, v_set.subject_id, p_settlement_id, v_num, v_full, auth.uid(),
    coalesce(nullif(v_cfg.legal_name, ''), v_cfg.app_name), v_cfg.tax_id, v_cfg.fiscal_address,
    coalesce(v_nombre, '—'), v_nif, v_dir,
    v_set.currency, v_base, coalesce(p_tax_rate, 0), v_tax, v_base + v_tax,
    jsonb_build_array(jsonb_build_object(
      'concept', 'Comisión de la plataforma',
      'lines', v_set.lines,
      'amount_cents', v_base)),
    v_cfg.invoice_note
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'already', false, 'id', v_id, 'full_number', v_full);
end;
$$;

alter table public.platform_invoices enable row level security;
alter table public.platform_invoices force row level security;

drop policy if exists platform_invoices_read on public.platform_invoices;
create policy platform_invoices_read on public.platform_invoices
  for select to authenticated
  using (
    public.is_superadmin()
    or (subject_type = 'restaurant' and public.is_staff_of(subject_id))
    or (subject_type = 'courier' and subject_id = public.my_courier_id())
  );

grant select on public.platform_invoices to authenticated;
grant execute on function public.issue_platform_invoice(uuid, numeric) to authenticated;
