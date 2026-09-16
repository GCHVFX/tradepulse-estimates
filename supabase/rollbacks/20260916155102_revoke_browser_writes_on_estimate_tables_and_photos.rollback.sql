-- MANUAL ROLLBACK. NOT A MIGRATION. Do not move this file into
-- supabase/migrations/, and do not apply it unless the forward migration below
-- has to be undone:
--
--   supabase/migrations/20260916155102_revoke_browser_writes_on_estimate_tables_and_photos.sql
--
-- It restores the exact pre-change state captured from production on
-- 2026-09-16 immediately before that migration was applied, and it deliberately
-- reopens blockers B1 and B2 (browser writes to estimate tables, and browser
-- delete-then-upload of estimate photos). Run it only to restore service, in
-- one transaction, from the Supabase SQL editor or an equivalent postgres
-- session.

begin;

-- ── B1: restore the browser write grants ────────────────────────────────────

grant insert, update, delete, truncate
  on public.tpe_estimates, public.tpe_estimate_items, public.tpe_estimate_photos
  to anon, authenticated;

-- ── B1: restore the original FOR ALL owner policies ─────────────────────────

drop policy if exists tpe_estimates_owner_select on public.tpe_estimates;
create policy tpe_estimates_owner_access
  on public.tpe_estimates
  as permissive
  for all
  to public
  using (
    business_id in (
      select tpe_businesses.id
        from public.tpe_businesses
       where tpe_businesses.owner_user_id = (select auth.uid() as uid)
    )
  )
  with check (
    business_id in (
      select tpe_businesses.id
        from public.tpe_businesses
       where tpe_businesses.owner_user_id = (select auth.uid() as uid)
    )
  );

drop policy if exists tpe_estimate_items_owner_select on public.tpe_estimate_items;
create policy tpe_estimate_items_owner_access
  on public.tpe_estimate_items
  as permissive
  for all
  to public
  using (
    estimate_id in (
      select e.id
        from public.tpe_estimates e
        join public.tpe_businesses b on b.id = e.business_id
       where b.owner_user_id = (select auth.uid() as uid)
    )
  )
  with check (
    estimate_id in (
      select e.id
        from public.tpe_estimates e
        join public.tpe_businesses b on b.id = e.business_id
       where b.owner_user_id = (select auth.uid() as uid)
    )
  );

drop policy if exists tpe_estimate_photos_owner_select on public.tpe_estimate_photos;
create policy tpe_estimate_photos_owner_access
  on public.tpe_estimate_photos
  as permissive
  for all
  to public
  using (
    estimate_id in (
      select e.id
        from public.tpe_estimates e
        join public.tpe_businesses b on b.id = e.business_id
       where b.owner_user_id = (select auth.uid() as uid)
    )
  )
  with check (
    estimate_id in (
      select e.id
        from public.tpe_estimates e
        join public.tpe_businesses b on b.id = e.business_id
       where b.owner_user_id = (select auth.uid() as uid)
    )
  );

-- ── B2: restore both buckets on the owner Storage write policies ────────────

alter policy "tpe: owners can upload their own files"
  on storage.objects
  with check (
    bucket_id = any (array['logos'::text, 'tpe-estimate-photos'::text])
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

alter policy "tpe: owners can delete their own files"
  on storage.objects
  using (
    bucket_id = any (array['logos'::text, 'tpe-estimate-photos'::text])
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

commit;
