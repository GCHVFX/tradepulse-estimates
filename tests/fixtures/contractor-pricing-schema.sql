-- The smallest schema that reproduces production for the contractor-pricing
-- save transaction, for the disposable PostgreSQL used by
-- tests/smoke/contractor-pricing-route.spec.ts.
--
-- Only the tables and constraints tpe_save_contractor_pricing actually touches.
-- Column types, defaults, nullability and every CHECK below were read from the
-- live database (information_schema.columns and pg_constraint) so the
-- transaction is exercised against the same rules it will meet in production:
-- the not-blank description, the item_type whitelist, the quantity and markup
-- ranges, the pricing_source whitelist and the cascade on delete.
--
-- Auth, storage, RLS and every table the function does not read are out of
-- scope. This is a fixture, not a copy of the database.

create extension if not exists pgcrypto;

create table tpe_businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid,
  name text not null default 'Test Business',
  labour_rate numeric not null default 0,
  markup_percent numeric not null default 0,
  deposit_percent numeric,
  deposit_threshold numeric,
  tax_label text not null default 'GST',
  tax_rate numeric not null default 5,
  estimate_currency text not null default 'cad',
  created_at timestamptz not null default now()
);

create table tpe_estimates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tpe_businesses(id),
  title text,
  summary text,
  status text not null default 'needs_review',
  source text not null default 'website_quote',
  pricing_source text not null default 'markdown',
  customer_pricing_mode text not null default 'detailed',
  currency text not null default 'cad',
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_email text not null default '',
  job_address text not null default '',
  description text not null default '',
  location text not null default '',
  service_type text not null default '',
  urgency text not null default '',
  prepared_by text not null default '',
  sent_at timestamptz,
  copied_at timestamptz,
  completed_at timestamptz,
  review_requested_at timestamptz,
  payment_status text,
  invoice_amount numeric,
  include_photos boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tpe_estimates_currency_check check (currency = any (array['cad', 'usd'])),
  constraint tpe_estimates_customer_pricing_mode_valid
    check (customer_pricing_mode = any (array['detailed', 'grouped'])),
  constraint tpe_estimates_pricing_source_valid
    check (pricing_source = any (array['markdown', 'structured', 'contractor_pricing']))
);

create table tpe_estimate_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references tpe_estimates(id) on delete cascade,
  description text not null,
  item_type text not null default 'other',
  is_allowance boolean not null default false,
  quantity numeric not null default 1,
  unit text,
  unit_price numeric not null default 0,
  line_total numeric not null default 0,
  labour_hours numeric,
  labour_rate numeric,
  markup_percent numeric,
  group_label text,
  customer_visible boolean not null default true,
  display_order integer not null default 0,
  taxable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tpe_estimate_items_description_not_blank check (btrim(description) <> ''),
  constraint tpe_estimate_items_display_order_nonneg check (display_order >= 0),
  constraint tpe_estimate_items_item_type_valid
    check (item_type = any (array['labour', 'material', 'service', 'allowance', 'other'])),
  constraint tpe_estimate_items_labour_hours_nonneg
    check (labour_hours is null or labour_hours >= 0),
  constraint tpe_estimate_items_labour_rate_nonneg
    check (labour_rate is null or labour_rate >= 0),
  constraint tpe_estimate_items_markup_percent_range
    check (markup_percent is null or (markup_percent >= 0 and markup_percent <= 1000)),
  constraint tpe_estimate_items_quantity_nonneg check (quantity >= 0)
);

-- The migration under test creates the function as service_role-only. That role
-- does not exist in a bare PostgreSQL instance, so create it here and let the
-- grants in the migration apply unchanged.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end
$$;
