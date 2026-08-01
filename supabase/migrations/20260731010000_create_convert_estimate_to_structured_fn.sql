-- Lazy per-estimate conversion: the atomic half.
--
-- WHY A DATABASE FUNCTION. PostgREST cannot span a transaction across separate
-- HTTP calls, so inserting the items and flipping tpe_estimates.pricing_source
-- as two supabaseAdmin calls would not be atomic: a failure between them would
-- leave structured rows behind an estimate still marked markdown, which is
-- exactly the dual-source state the architecture forbids. A PL/pgSQL function
-- runs in a single implicit transaction, so any RAISE below rolls back every
-- insert and the update together. This mirrors the one pre-existing RPC in this
-- project, increment_rate_limit, including its p_ argument prefix.
--
-- SECURITY MODEL.
--   SECURITY INVOKER (the default), deliberately, not DEFINER. There is no
--   privilege to escalate: the only caller is the service-role client, which
--   already bypasses RLS. Running as the invoker means that if this function
--   were ever reached by anon or authenticated it would be subject to their
--   deny-all RLS rather than running with owner rights.
--   EXECUTE is revoked from public, anon, and authenticated, and granted only
--   to service_role. Postgres grants EXECUTE to PUBLIC by default, so the
--   revoke is required, not decorative.
--   Ownership is checked twice: in application code before the call, and again
--   here under a row lock via the p_business_id predicate.
--
-- The function only inserts items and flips the pricing source. It performs no
-- parsing, no totalling of markdown, and no repair.

create or replace function public.tpe_convert_estimate_to_structured(
  p_estimate_id      uuid,
  p_business_id      uuid,
  p_items            jsonb,
  p_expected_count   integer,
  p_expected_subtotal numeric
) returns jsonb
language plpgsql
as $$
declare
  v_estimate record;
  v_existing integer;
  v_inserted integer;
  v_subtotal numeric;
begin
  -- 1. Lock the estimate and confirm ownership inside the transaction, so a
  --    concurrent send or a second conversion cannot interleave.
  select id, business_id, pricing_source, status, sent_at
    into v_estimate
    from public.tpe_estimates
   where id = p_estimate_id
     and business_id = p_business_id
   for update;

  if not found then
    raise exception 'ESTIMATE_NOT_FOUND_OR_NOT_OWNED';
  end if;

  -- 2. Re-check eligibility under the lock. The caller checked already; this is
  --    the check that actually counts.
  if v_estimate.pricing_source <> 'markdown' then
    raise exception 'ALREADY_STRUCTURED';
  end if;

  if v_estimate.sent_at is not null or v_estimate.status in ('sent', 'done') then
    raise exception 'ESTIMATE_CUSTOMER_VISIBLE';
  end if;

  -- 3. Refuse if any structured row already exists, so a retry cannot duplicate.
  select count(*) into v_existing
    from public.tpe_estimate_items
   where estimate_id = p_estimate_id;

  if v_existing > 0 then
    raise exception 'STRUCTURED_ROWS_ALREADY_EXIST';
  end if;

  -- 4. Validate the payload shape before touching anything.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS_PAYLOAD';
  end if;

  if p_expected_count is null or p_expected_count < 1 then
    raise exception 'NO_PRICED_ITEMS';
  end if;

  if jsonb_array_length(p_items) <> p_expected_count then
    raise exception 'ITEM_COUNT_MISMATCH';
  end if;

  -- 5. Insert. Only these known keys are read, so a caller cannot smuggle in an
  --    arbitrary column name. estimate_id comes from the argument, never the
  --    payload, so no row can be attached to a different estimate.
  insert into public.tpe_estimate_items (
    estimate_id, description, item_type, is_allowance,
    quantity, unit, unit_price, line_total,
    labour_hours, labour_rate, markup_percent,
    group_label, customer_visible, display_order, taxable
  )
  select
    p_estimate_id,
    e ->> 'description',
    coalesce(e ->> 'item_type', 'other'),
    coalesce((e ->> 'is_allowance')::boolean, false),
    coalesce((e ->> 'quantity')::numeric, 1),
    e ->> 'unit',
    coalesce((e ->> 'unit_price')::numeric, 0),
    coalesce((e ->> 'line_total')::numeric, 0),
    (e ->> 'labour_hours')::numeric,
    (e ->> 'labour_rate')::numeric,
    (e ->> 'markup_percent')::numeric,
    e ->> 'group_label',
    coalesce((e ->> 'customer_visible')::boolean, true),
    coalesce((e ->> 'display_order')::integer, 0),
    coalesce((e ->> 'taxable')::boolean, true)
  from jsonb_array_elements(p_items) as e;

  get diagnostics v_inserted = row_count;

  if v_inserted <> p_expected_count then
    raise exception 'INSERTED_ROW_COUNT_MISMATCH';
  end if;

  -- 6. Reconfirm the subtotal from what actually landed in the table, not from
  --    what the caller claimed. A caller-supplied total is never trusted.
  select coalesce(sum(line_total), 0) into v_subtotal
    from public.tpe_estimate_items
   where estimate_id = p_estimate_id;

  if round(v_subtotal, 2) is distinct from round(p_expected_subtotal, 2) then
    raise exception 'SUBTOTAL_MISMATCH_AFTER_INSERT';
  end if;

  -- 7. Only now flip the source. Nothing else on the estimate is touched: the
  --    summary, status, timestamps, and customer fields are all left alone.
  update public.tpe_estimates
     set pricing_source = 'structured'
   where id = p_estimate_id;

  return jsonb_build_object(
    'estimate_id',    p_estimate_id,
    'inserted_count', v_inserted,
    'subtotal',       v_subtotal,
    'pricing_source', 'structured'
  );
end;
$$;

revoke all on function public.tpe_convert_estimate_to_structured(uuid, uuid, jsonb, integer, numeric) from public;
revoke all on function public.tpe_convert_estimate_to_structured(uuid, uuid, jsonb, integer, numeric) from anon;
revoke all on function public.tpe_convert_estimate_to_structured(uuid, uuid, jsonb, integer, numeric) from authenticated;
grant execute on function public.tpe_convert_estimate_to_structured(uuid, uuid, jsonb, integer, numeric) to service_role;

comment on function public.tpe_convert_estimate_to_structured(uuid, uuid, jsonb, integer, numeric) is
  'Atomically inserts structured estimate items and flips tpe_estimates.pricing_source to structured. Service-role only. Re-checks ownership and eligibility under a row lock. Any failure rolls back every insert and the flip together. Called only by lib/estimate-item-migration.ts.';
