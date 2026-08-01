-- Slice 1 of the grouped-pricing plan: structured estimate-item schema.
--
-- Purely additive. Creates one new empty table and adds two columns to
-- tpe_estimates. No existing row is modified, no data is backfilled, and no
-- estimate is flipped to structured. Nothing in the application reads or writes
-- any of this yet.
--
-- HOW THIS IS APPLIED: this repository has no Supabase CLI workflow and had no
-- migrations directory before this file. Schema changes are applied through the
-- Supabase MCP `apply_migration` tool, which records the migration in
-- supabase_migrations.schema_migrations. This file is the durable in-repo record
-- of the exact SQL that was applied, kept in the standard Supabase layout so a
-- CLI workflow can adopt it later without rewriting history.
--
-- Conventions matched against the existing tpe_ tables:
--   uuid primary keys with gen_random_uuid()
--   unconstrained `numeric` for money and quantities, never floating point
--   timestamptz not null default now() for created_at and updated_at
--   no updated_at trigger anywhere in this schema, so none is introduced here
--   percentages stored as whole numbers, so 20 means 20 percent, matching
--     tpe_businesses.markup_percent, deposit_percent, and tax_rate

-- ── New table ────────────────────────────────────────────────────────────────

create table if not exists public.tpe_estimate_items (
  id                uuid primary key default gen_random_uuid(),
  estimate_id       uuid not null references public.tpe_estimates(id) on delete cascade,

  -- What the row is
  description       text not null,
  item_type         text not null default 'other',
  is_allowance      boolean not null default false,

  -- How it is priced. quantity times unit_price is the intended meaning of
  -- line_total for quantity rows; for a flat fee, quantity stays 1 and
  -- unit_price equals line_total. line_total is stored rather than computed so
  -- a future approval snapshot can be verified without recomputation.
  quantity          numeric not null default 1,
  unit              text,
  unit_price        numeric not null default 0,
  line_total        numeric not null default 0,

  -- Labour detail, optional and only meaningful on labour rows.
  labour_hours      numeric,
  labour_rate       numeric,

  -- Markup already applied to unit_price, recorded for auditability only.
  -- Whole number: 20 means 20 percent.
  markup_percent    numeric,

  -- Presentation
  group_label       text,
  customer_visible  boolean not null default true,
  display_order     integer not null default 0,

  taxable           boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tpe_estimate_items_description_not_blank
    check (btrim(description) <> ''),

  constraint tpe_estimate_items_item_type_valid
    check (item_type in ('labour', 'material', 'service', 'allowance', 'other')),

  -- Quantities and durations cannot be negative. Monetary columns deliberately
  -- are NOT sign constrained: the current markdown format permits a negative
  -- amount (a credit or discount row), lib/estimate-items.ts treats it as a
  -- non-blocking warning rather than a refusal, and constraining it here would
  -- make a future backfill fail on data the conversion layer says is valid.
  constraint tpe_estimate_items_quantity_nonneg      check (quantity >= 0),
  constraint tpe_estimate_items_display_order_nonneg check (display_order >= 0),
  constraint tpe_estimate_items_labour_hours_nonneg  check (labour_hours is null or labour_hours >= 0),
  constraint tpe_estimate_items_labour_rate_nonneg   check (labour_rate  is null or labour_rate  >= 0),
  constraint tpe_estimate_items_markup_percent_range check (markup_percent is null or (markup_percent >= 0 and markup_percent <= 1000))
);

-- One composite index, not two. Its leading column serves the foreign key
-- lookup, and the pair serves the only read this table will have for a long
-- time: "give me the items of one estimate, in order". No uniqueness on
-- (estimate_id, display_order): a unique constraint would make reordering two
-- rows require a temporary value or a deferred constraint, for no benefit.
create index if not exists tpe_estimate_items_estimate_id_display_order_idx
  on public.tpe_estimate_items (estimate_id, display_order);

-- RLS: enabled, with no policies, exactly matching all eight existing tpe_
-- tables. Verified on 2026-07-31: every tpe_ table has rowsecurity = true and
-- zero policies, service_role has bypassrls, and authenticated does not. The
-- application reaches every table through the service-role client and enforces
-- ownership in code. Enabling RLS with no policy therefore denies anon and
-- authenticated all row access to this table, which is the intended posture and
-- the strictest available one.
--
-- See TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md for the four owner-scoped policies
-- that were written and reviewed but deliberately NOT applied, and why.
alter table public.tpe_estimate_items enable row level security;

comment on table public.tpe_estimate_items is
  'Structured priced rows for an estimate. Unused as of slice 1: tpe_estimates.pricing_source is markdown for every row, so markdown remains authoritative for pricing. See TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md.';

-- ── New columns on tpe_estimates ─────────────────────────────────────────────
--
-- On Postgres 11+ an ADD COLUMN with a constant default is a metadata-only
-- change: no table rewrite, no row touched, no trigger fired. This schema has
-- no triggers at all, so updated_at is unaffected.

alter table public.tpe_estimates
  add column if not exists pricing_source        text not null default 'markdown',
  add column if not exists customer_pricing_mode text not null default 'detailed';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so these are guarded to keep
-- the migration safe to re-run after a partial failure.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tpe_estimates_pricing_source_valid'
  ) then
    alter table public.tpe_estimates
      add constraint tpe_estimates_pricing_source_valid
        check (pricing_source in ('markdown', 'structured'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tpe_estimates_customer_pricing_mode_valid'
  ) then
    alter table public.tpe_estimates
      add constraint tpe_estimates_customer_pricing_mode_valid
        check (customer_pricing_mode in ('detailed', 'grouped'));
  end if;
end $$;

comment on column public.tpe_estimates.pricing_source is
  'Which representation is authoritative for this estimate''s pricing. markdown means the ## Line Items table in summary. structured means tpe_estimate_items. One-way flip, set only by a future backfill after every invariant passes. Never both.';

comment on column public.tpe_estimates.customer_pricing_mode is
  'How pricing is shown to the customer. detailed is every line item, the current and only implemented behaviour. grouped is by work package, not yet built.';
