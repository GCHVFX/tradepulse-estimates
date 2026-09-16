-- Contractor-owned pricing, Phase 1 slice 2.
-- See specs/contractor-owned-pricing.md sections 3, 11, 12 and 15.
--
-- NOT APPLIED TO PRODUCTION. Slice 2 is local only. Apply this together with
-- the slice that actually routes contractor pricing through the app, not
-- before: nothing reads these columns until then.
--
-- Two things, because they are one unit of meaning: the per-estimate snapshots
-- the pricing save writes, and the single transactional save itself.
--
-- WHY A DATABASE FUNCTION. PostgREST cannot span a transaction across separate
-- HTTP calls, so replacing the pricing rows, promoting an inbound quote, and
-- writing the permitted business defaults as separate supabaseAdmin calls
-- would leave a partially saved pricing state observable between them. A
-- PL/pgSQL function runs in one implicit transaction, so any raise below rolls
-- all of it back together. Same reasoning, and the same shape, as the existing
-- tpe_convert_estimate_to_structured, which this does not touch.

-- --- Snapshots --------------------------------------------------------------
--
-- A later change to the business's Rates must never move an estimate that has
-- already been priced, so the estimate carries its own copy. Nullable: an
-- estimate that has not been priced yet has no snapshot, and a null tax
-- snapshot is an incomplete pricing state, never 0%.

alter table tpe_estimates
  add column if not exists tax_label_snapshot text,
  add column if not exists tax_rate_snapshot numeric,
  add column if not exists deposit_percent_snapshot numeric,
  add column if not exists deposit_threshold_snapshot numeric;

comment on column tpe_estimates.tax_rate_snapshot is
  'The tax rate this estimate was priced with. Null means not priced yet, which is incomplete, not 0%.';

-- --- The one transactional pricing save ---------------------------------------
--
-- Persists inputs only. Every derived figure (subtotal, tax, total, deposit,
-- balance) is calculated in lib/contractor-pricing.ts and never here, so there
-- is exactly one implementation of that arithmetic.

create or replace function public.tpe_save_contractor_pricing(
  p_estimate_id       uuid,
  p_business_id       uuid,
  p_rows              jsonb,
  p_tax               jsonb default null,
  p_first_hourly_rate numeric default null
) returns jsonb
language plpgsql
as $$
declare
  v_estimate record;
  v_business record;
  v_is_intake boolean;
  v_tax_label text;
  v_tax_rate numeric;
  v_inserted integer;
  v_rows jsonb;
begin
  -- 1. Lock the estimate and confirm ownership inside the transaction. A
  --    foreign estimate reads as not found rather than leaking its existence.
  select id, business_id, source, status, pricing_source, sent_at, copied_at,
         tax_label_snapshot, tax_rate_snapshot,
         deposit_percent_snapshot, deposit_threshold_snapshot
    into v_estimate
    from public.tpe_estimates
   where id = p_estimate_id
     and business_id = p_business_id
   for update;

  if not found then
    raise exception 'ESTIMATE_NOT_FOUND_OR_NOT_OWNED';
  end if;

  -- 2. Re-evaluate delivery under the lock. The route checked already; this is
  --    the check that counts, because an estimate can be delivered between the
  --    route's read and this write. Same rule as lib/estimate-delivery.ts.
  if v_estimate.sent_at is not null
     or v_estimate.copied_at is not null
     or v_estimate.status in ('sent', 'done') then
    raise exception 'ESTIMATE_DELIVERED';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_ROWS_PAYLOAD';
  end if;

  -- 3. Lock the business too: the permitted default writes below and the
  --    snapshot copies both read it, and both must see one consistent row.
  select id, labour_rate, tax_label, tax_rate, deposit_percent, deposit_threshold
    into v_business
    from public.tpe_businesses
   where id = p_business_id
   for update;

  if not found then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;

  -- 4. Inbound intake is promoted on its first pricing save, complete or not.
  v_is_intake := v_estimate.source = 'website_quote'
             and v_estimate.status = 'needs_review'
             and v_estimate.pricing_source is distinct from 'contractor_pricing';

  -- Anything that is neither already contractor-priced nor promotable intake
  -- is legacy, and legacy is read-only (spec section 14).
  if not v_is_intake and v_estimate.pricing_source is distinct from 'contractor_pricing' then
    raise exception 'ESTIMATE_NOT_CONTRACTOR_PRICING';
  end if;

  if v_is_intake then
    update public.tpe_estimates
       set pricing_source = 'contractor_pricing',
           status = 'draft',
           tax_label_snapshot = v_business.tax_label,
           tax_rate_snapshot = v_business.tax_rate,
           deposit_percent_snapshot = v_business.deposit_percent,
           deposit_threshold_snapshot = v_business.deposit_threshold
     where id = p_estimate_id;
  end if;

  -- 5. An explicit tax change updates this estimate's snapshot and the
  --    business default together: tax is a jurisdiction setting. Without one,
  --    existing snapshots are preserved exactly.
  if p_tax is not null then
    v_tax_label := p_tax ->> 'label';
    v_tax_rate := (p_tax ->> 'rate')::numeric;

    if v_tax_label is null or btrim(v_tax_label) = '' or v_tax_rate is null then
      raise exception 'INVALID_TAX_PAYLOAD';
    end if;

    update public.tpe_estimates
       set tax_label_snapshot = v_tax_label,
           tax_rate_snapshot = v_tax_rate
     where id = p_estimate_id;

    update public.tpe_businesses
       set tax_label = v_tax_label,
           tax_rate = v_tax_rate
     where id = p_business_id;
  end if;

  -- 6. The first hourly rate a contractor ever enters becomes their default.
  --    Only when they have none: an override on a business that already has a
  --    rate changes this estimate only.
  if p_first_hourly_rate is not null
     and p_first_hourly_rate > 0
     and coalesce(v_business.labour_rate, 0) = 0 then
    update public.tpe_businesses
       set labour_rate = p_first_hourly_rate
     where id = p_business_id;
  end if;

  -- 7. Replace, never merge. The PUT carries the whole current pricing state,
  --    so a removed input must leave no row behind. Scoped to this estimate.
  delete from public.tpe_estimate_items where estimate_id = p_estimate_id;

  insert into public.tpe_estimate_items (
    estimate_id, description, item_type, quantity, unit, unit_price,
    line_total, markup_percent, display_order
  )
  select
    p_estimate_id,
    e ->> 'description',
    e ->> 'item_type',
    (e ->> 'quantity')::numeric,
    e ->> 'unit',
    (e ->> 'unit_price')::numeric,
    (e ->> 'line_total')::numeric,
    nullif(e ->> 'markup_percent', '')::numeric,
    coalesce((e ->> 'display_order')::integer, 0)
  from jsonb_array_elements(p_rows) as e;

  get diagnostics v_inserted = row_count;

  if v_inserted <> jsonb_array_length(p_rows) then
    raise exception 'INSERTED_ROW_COUNT_MISMATCH';
  end if;

  -- 8. Return the saved state so the route answers without a second read and
  --    without guessing. Derived pricing is calculated from this, in
  --    TypeScript, by lib/contractor-pricing.ts.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'item_type', item_type,
             'unit', unit,
             'quantity', quantity,
             'unit_price', unit_price,
             'markup_percent', markup_percent,
             'description', description,
             'display_order', display_order
           ) order by display_order
         ), '[]'::jsonb)
    into v_rows
    from public.tpe_estimate_items
   where estimate_id = p_estimate_id;

  select id, status, pricing_source,
         tax_label_snapshot, tax_rate_snapshot,
         deposit_percent_snapshot, deposit_threshold_snapshot
    into v_estimate
    from public.tpe_estimates
   where id = p_estimate_id;

  select labour_rate into v_business.labour_rate
    from public.tpe_businesses
   where id = p_business_id;

  return jsonb_build_object(
    'estimate_id', v_estimate.id,
    'status', v_estimate.status,
    'pricing_source', v_estimate.pricing_source,
    'promoted', v_is_intake,
    'tax_label_snapshot', v_estimate.tax_label_snapshot,
    'tax_rate_snapshot', v_estimate.tax_rate_snapshot,
    'deposit_percent_snapshot', v_estimate.deposit_percent_snapshot,
    'deposit_threshold_snapshot', v_estimate.deposit_threshold_snapshot,
    'business_labour_rate', v_business.labour_rate,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.tpe_save_contractor_pricing(uuid, uuid, jsonb, jsonb, numeric) from public;
revoke all on function public.tpe_save_contractor_pricing(uuid, uuid, jsonb, jsonb, numeric) from anon;
revoke all on function public.tpe_save_contractor_pricing(uuid, uuid, jsonb, jsonb, numeric) from authenticated;
grant execute on function public.tpe_save_contractor_pricing(uuid, uuid, jsonb, jsonb, numeric) to service_role;

comment on function public.tpe_save_contractor_pricing(uuid, uuid, jsonb, jsonb, numeric) is
  'Atomically saves contractor pricing for one estimate: replaces its tpe_estimate_items rows, promotes inbound website_quote intake on first save, writes the permitted business defaults, and preserves snapshots otherwise. Service-role only. Re-checks ownership and delivery under a row lock. Persists inputs only; derived pricing is calculated in lib/contractor-pricing.ts. Called only by app/api/estimates/[id]/pricing/route.ts.';
