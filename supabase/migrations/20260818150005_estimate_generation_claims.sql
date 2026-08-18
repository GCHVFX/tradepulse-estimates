-- A claim is acquired before Anthropic streaming. Account deletion refuses to
-- remove a business while an unexpired claim exists, preventing a paid stream
-- from finishing after its backing business has disappeared.
create table public.tpe_estimate_generation_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.tpe_businesses(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  claim_type text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  constraint tpe_estimate_generation_claims_type_check check (claim_type in ('generation', 'deletion')),
  constraint tpe_estimate_generation_claims_expiry_check check (expires_at > created_at)
);

create index tpe_estimate_generation_claims_active_business_idx
  on public.tpe_estimate_generation_claims (business_id, expires_at);

alter table public.tpe_estimate_generation_claims enable row level security;

revoke all on table public.tpe_estimate_generation_claims from public;
revoke all on table public.tpe_estimate_generation_claims from anon;
revoke all on table public.tpe_estimate_generation_claims from authenticated;
grant select, insert, update, delete on table public.tpe_estimate_generation_claims to service_role;

create policy "Service role manages estimate generation claims"
  on public.tpe_estimate_generation_claims
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.claim_estimate_generation(
  p_business_id uuid,
  p_owner_user_id uuid
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_claim_id uuid;
begin
  perform 1
    from public.tpe_businesses
   where id = p_business_id
     and owner_user_id = p_owner_user_id
   for key share;

  if not found then
    return null;
  end if;

  delete from public.tpe_estimate_generation_claims
   where business_id = p_business_id
     and expires_at <= now();

  if exists (
    select 1
      from public.tpe_estimate_generation_claims
     where business_id = p_business_id
       and claim_type = 'deletion'
       and expires_at > now()
  ) then
    return null;
  end if;

  insert into public.tpe_estimate_generation_claims (business_id, owner_user_id, claim_type)
  values (p_business_id, p_owner_user_id, 'generation')
  returning id into v_claim_id;

  return v_claim_id;
end;
$$;

create or replace function public.release_estimate_generation_claim(
  p_claim_id uuid,
  p_business_id uuid,
  p_owner_user_id uuid
) returns void
language sql
set search_path = public
as $$
  delete from public.tpe_estimate_generation_claims
   where id = p_claim_id
     and business_id = p_business_id
     and owner_user_id = p_owner_user_id
     and claim_type = 'generation';
$$;

create or replace function public.begin_business_deletion(
  p_business_id uuid,
  p_owner_user_id uuid
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform 1
    from public.tpe_businesses
   where id = p_business_id
     and owner_user_id = p_owner_user_id
   for update;

  if not found then
    return false;
  end if;

  delete from public.tpe_estimate_generation_claims
   where business_id = p_business_id
     and expires_at <= now();

  if exists (
    select 1
     from public.tpe_estimate_generation_claims
     where business_id = p_business_id
       and claim_type = 'generation'
       and expires_at > now()
  ) then
    raise exception 'ESTIMATE_GENERATION_IN_PROGRESS';
  end if;

  if exists (
    select 1
      from public.tpe_estimate_generation_claims
     where business_id = p_business_id
       and claim_type = 'deletion'
       and expires_at > now()
  ) then
    raise exception 'BUSINESS_DELETION_IN_PROGRESS';
  end if;

  insert into public.tpe_estimate_generation_claims (business_id, owner_user_id, claim_type, expires_at)
  values (p_business_id, p_owner_user_id, 'deletion', now() + interval '30 minutes');

  return true;
end;
$$;

create or replace function public.release_business_deletion_claim(
  p_business_id uuid,
  p_owner_user_id uuid
) returns void
language sql
set search_path = public
as $$
  delete from public.tpe_estimate_generation_claims
   where business_id = p_business_id
     and owner_user_id = p_owner_user_id
     and claim_type = 'deletion';
$$;

revoke all on function public.claim_estimate_generation(uuid, uuid) from public;
revoke all on function public.claim_estimate_generation(uuid, uuid) from anon;
revoke all on function public.claim_estimate_generation(uuid, uuid) from authenticated;
grant execute on function public.claim_estimate_generation(uuid, uuid) to service_role;

revoke all on function public.release_estimate_generation_claim(uuid, uuid, uuid) from public;
revoke all on function public.release_estimate_generation_claim(uuid, uuid, uuid) from anon;
revoke all on function public.release_estimate_generation_claim(uuid, uuid, uuid) from authenticated;
grant execute on function public.release_estimate_generation_claim(uuid, uuid, uuid) to service_role;

revoke all on function public.begin_business_deletion(uuid, uuid) from public;
revoke all on function public.begin_business_deletion(uuid, uuid) from anon;
revoke all on function public.begin_business_deletion(uuid, uuid) from authenticated;
grant execute on function public.begin_business_deletion(uuid, uuid) to service_role;

revoke all on function public.release_business_deletion_claim(uuid, uuid) from public;
revoke all on function public.release_business_deletion_claim(uuid, uuid) from anon;
revoke all on function public.release_business_deletion_claim(uuid, uuid) from authenticated;
grant execute on function public.release_business_deletion_claim(uuid, uuid) to service_role;

create or replace function public.tpe_delete_business_account_data(
  p_business_id uuid,
  p_owner_user_id uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_business_id uuid;
  v_estimate_ids uuid[];
  v_payment_reminders integer := 0;
  v_estimate_changes integer := 0;
  v_estimate_items integer := 0;
  v_estimate_line_items integer := 0;
  v_estimate_photos integer := 0;
  v_estimates integer := 0;
  v_pricebook_items integer := 0;
  v_rate_limits integer := 0;
begin
  select id
    into v_business_id
    from public.tpe_businesses
   where id = p_business_id
     and owner_user_id = p_owner_user_id
   for update;

  if not found then
    return jsonb_build_object('already_deleted', true);
  end if;

  delete from public.tpe_estimate_generation_claims
   where business_id = p_business_id
     and expires_at <= now();

  if exists (
    select 1
      from public.tpe_estimate_generation_claims
     where business_id = p_business_id
       and claim_type = 'generation'
       and expires_at > now()
  ) then
    raise exception 'ESTIMATE_GENERATION_IN_PROGRESS';
  end if;

  if not exists (
    select 1
      from public.tpe_estimate_generation_claims
     where business_id = p_business_id
       and owner_user_id = p_owner_user_id
       and claim_type = 'deletion'
       and expires_at > now()
  ) then
    raise exception 'BUSINESS_DELETION_CLAIM_REQUIRED';
  end if;

  delete from public.tpe_estimate_generation_claims
   where business_id = p_business_id
     and owner_user_id = p_owner_user_id
     and claim_type = 'deletion';

  select coalesce(array_agg(id), array[]::uuid[])
    into v_estimate_ids
    from (
      select id
        from public.tpe_estimates
       where business_id = p_business_id
       for update
    ) as owned_estimates;

  delete from public.tpe_payment_reminders
   where business_id = p_business_id
      or estimate_id = any(v_estimate_ids);
  get diagnostics v_payment_reminders = row_count;

  delete from public.tpe_estimate_changes
   where estimate_id = any(v_estimate_ids);
  get diagnostics v_estimate_changes = row_count;

  delete from public.tpe_estimate_items
   where estimate_id = any(v_estimate_ids);
  get diagnostics v_estimate_items = row_count;

  delete from public.tpe_estimate_line_items
   where estimate_id = any(v_estimate_ids);
  get diagnostics v_estimate_line_items = row_count;

  delete from public.tpe_estimate_photos
   where estimate_id = any(v_estimate_ids);
  get diagnostics v_estimate_photos = row_count;

  delete from public.tpe_estimates
   where business_id = p_business_id;
  get diagnostics v_estimates = row_count;

  delete from public.tpe_pricebook_items
   where business_id = p_business_id;
  get diagnostics v_pricebook_items = row_count;

  delete from public.tpe_rate_limits
   where key = p_owner_user_id::text;
  get diagnostics v_rate_limits = row_count;

  delete from public.tpe_businesses
   where id = p_business_id
     and owner_user_id = p_owner_user_id;

  if not found then
    raise exception 'BUSINESS_DELETE_FAILED';
  end if;

  return jsonb_build_object(
    'already_deleted', false,
    'payment_reminders', v_payment_reminders,
    'estimate_changes', v_estimate_changes,
    'estimate_items', v_estimate_items,
    'estimate_line_items', v_estimate_line_items,
    'estimate_photos', v_estimate_photos,
    'estimates', v_estimates,
    'pricebook_items', v_pricebook_items,
    'rate_limits', v_rate_limits
  );
end;
$$;

revoke all on function public.tpe_delete_business_account_data(uuid, uuid) from public;
revoke all on function public.tpe_delete_business_account_data(uuid, uuid) from anon;
revoke all on function public.tpe_delete_business_account_data(uuid, uuid) from authenticated;
grant execute on function public.tpe_delete_business_account_data(uuid, uuid) to service_role;

comment on table public.tpe_estimate_generation_claims is
  'Service-role-only generation and deletion claims. Generation claims expire after 15 minutes and are acquired before Anthropic work; deletion claims expire after 30 minutes and are acquired before any external deletion side effect. Expired claims are removed inside claim and deletion transactions.';
