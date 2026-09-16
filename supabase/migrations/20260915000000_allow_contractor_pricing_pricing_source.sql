-- Allow 'contractor_pricing' as a pricing_source.
--
-- Phase 1 (specs/contractor-owned-pricing.md) introduces a third pricing model
-- where the contractor owns every price-driving number and the AI writes prose
-- only. It needs its own pricing_source value: 'structured' already means
-- "AI-authored prices copied into tpe_estimate_items", which is not the same
-- thing and must not be reused for it.
--
-- REPO ALIGNMENT, NOT A PENDING CHANGE. This was applied directly to the live
-- Supabase project on 2026-09-15, before this file existed. It is committed so
-- local and CI schema history match production. Applying it again is a no-op
-- in effect: the constraint is dropped by name and recreated identically.
--
-- The live constraint is named tpe_estimates_pricing_source_valid, not
-- ..._check. Dropping the wrong name leaves the old constraint in place and
-- every contractor_pricing insert fails.
--
-- The column default stays 'markdown'. The Clearwater quote form inserts
-- without a pricing_source, and an inbound quote carries no contractor-authored
-- price, so it must never default into 'contractor_pricing'.

alter table tpe_estimates
  drop constraint if exists tpe_estimates_pricing_source_valid;

alter table tpe_estimates
  add constraint tpe_estimates_pricing_source_valid
  check (pricing_source in ('markdown', 'structured', 'contractor_pricing'));
