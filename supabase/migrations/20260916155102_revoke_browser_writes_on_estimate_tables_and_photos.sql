-- Browser clients may read estimate data; they may not write it.
--
-- Phase 1 slice 5B security foundation (blockers B1 and B2 in HANDOFF.md).
--
-- B1. Every table below had one PERMISSIVE policy for role public, FOR ALL,
-- whose only condition was that the estimate's business belongs to auth.uid(),
-- and anon/authenticated held INSERT, UPDATE, DELETE and TRUNCATE. A signed-in
-- contractor could therefore rewrite, reprice and un-deliver their own
-- delivered estimate straight from the browser, around every server route.
-- That was demonstrated against production with a rolled-back probe.
--
-- Every legitimate write to these tables already runs server-side as
-- service_role: every application access in both the deployed commit
-- (6f411e3) and phase1-contractor-pricing goes through supabaseAdmin, no
-- browser code writes them, the Clearwater quote form uses the service-role
-- key, and every writing function runs with service_role-only EXECUTE.
-- service_role has BYPASSRLS, so none of it depends on a policy.
--
-- So: revoke the browser write privileges, and replace each FOR ALL policy with
-- a SELECT-only owner policy carrying the identical ownership predicate, so the
-- policy layer no longer describes a write it no longer allows. SELECT grants
-- stay. No anonymous read existed or is needed: /share/[id] and its PDF read
-- through supabaseAdmin, and signed and public Storage URLs are not subject to
-- these policies.
--
-- B2. The owner INSERT and DELETE Storage policies covered both 'logos' and
-- 'tpe-estimate-photos'. With no UPDATE policy an overwrite was refused, but
-- delete-then-upload at the same `${uid}/${estimateId}/${file}` path was not,
-- which let a delivered estimate's photo bytes change under an unchanged
-- tpe_estimate_photos row. Estimate photos are only ever uploaded and removed
-- server-side as service_role, so both policies narrow to 'logos'. 'logos' must
-- stay: the profile form removes a logo directly from the browser. The SELECT
-- policy is untouched, and the bucket stays private.
--
-- Manual recovery SQL: supabase/rollbacks/20260916155102_revoke_browser_writes_on_estimate_tables_and_photos.rollback.sql

-- ── B1: grants ──────────────────────────────────────────────────────────────

revoke insert, update, delete, truncate
  on public.tpe_estimates, public.tpe_estimate_items, public.tpe_estimate_photos
  from anon, authenticated;

-- ── B1: owner policies become read-only ─────────────────────────────────────

drop policy if exists tpe_estimates_owner_access on public.tpe_estimates;
create policy tpe_estimates_owner_select
  on public.tpe_estimates
  for select
  to authenticated
  using (
    business_id in (
      select tpe_businesses.id
        from public.tpe_businesses
       where tpe_businesses.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists tpe_estimate_items_owner_access on public.tpe_estimate_items;
create policy tpe_estimate_items_owner_select
  on public.tpe_estimate_items
  for select
  to authenticated
  using (
    estimate_id in (
      select e.id
        from public.tpe_estimates e
        join public.tpe_businesses b on b.id = e.business_id
       where b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists tpe_estimate_photos_owner_access on public.tpe_estimate_photos;
create policy tpe_estimate_photos_owner_select
  on public.tpe_estimate_photos
  for select
  to authenticated
  using (
    estimate_id in (
      select e.id
        from public.tpe_estimates e
        join public.tpe_businesses b on b.id = e.business_id
       where b.owner_user_id = (select auth.uid())
    )
  );

-- ── B2: browser Storage mutation narrows to logos ───────────────────────────

alter policy "tpe: owners can upload their own files"
  on storage.objects
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

alter policy "tpe: owners can delete their own files"
  on storage.objects
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
