-- Cost-amplification guards for rate-limited paid work and outbound delivery.
--
-- This migration is additive apart from making the existing rate-limit key
-- unique. Existing duplicate windows are collapsed before the constraint is
-- created, preserving the largest active window and the sum of active counts.

with ranked as (
  select
    id,
    key,
    action,
    expires_at,
    count,
    row_number() over (
      partition by key, action
      order by expires_at desc, created_at desc nulls last, id desc
    ) as row_number,
    max(expires_at) filter (where expires_at > now()) over (
      partition by key, action
    ) as active_expires_at,
    coalesce(sum(count) filter (where expires_at > now()) over (
      partition by key, action
    ), 0) as active_count
  from public.tpe_rate_limits
), survivors as (
  update public.tpe_rate_limits target
     set count = case
           when ranked.active_expires_at is not null then ranked.active_count
           else target.count
         end,
         expires_at = coalesce(ranked.active_expires_at, target.expires_at)
    from ranked
   where target.id = ranked.id
     and ranked.row_number = 1
  returning target.id
)
delete from public.tpe_rate_limits target
using ranked
where target.id = ranked.id
  and ranked.row_number > 1;

alter table public.tpe_rate_limits
  add constraint tpe_rate_limits_key_action_key unique (key, action);

-- The previous RPC atomically incremented existing windows but its caller
-- created a new window separately, allowing concurrent first requests to
-- bypass a limit. This single statement owns insert, reset, and increment.
create or replace function public.take_rate_limit(
  p_key text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns table (
  allowed boolean,
  remaining integer,
  window_expires_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_expires_at timestamptz;
begin
  if p_key is null or btrim(p_key) = '' then
    raise exception 'RATE_LIMIT_KEY_REQUIRED';
  end if;
  if p_action is null or btrim(p_action) = '' then
    raise exception 'RATE_LIMIT_ACTION_REQUIRED';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'RATE_LIMIT_CONFIGURATION_INVALID';
  end if;

  insert into public.tpe_rate_limits as rate_limit (key, action, count, expires_at)
  values (p_key, p_action, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key, action) do update
     set count = case
           when rate_limit.expires_at <= now() then 1
           else least(rate_limit.count + 1, p_limit + 1)
         end,
         expires_at = case
           when rate_limit.expires_at <= now()
             then now() + make_interval(secs => p_window_seconds)
           else rate_limit.expires_at
         end
  returning count, expires_at into v_count, v_expires_at;

  return query
  select
    v_count <= p_limit,
    greatest(0, p_limit - v_count),
    v_expires_at;
end;
$$;

revoke all on function public.take_rate_limit(text, text, integer, integer) from public;
revoke all on function public.take_rate_limit(text, text, integer, integer) from anon;
revoke all on function public.take_rate_limit(text, text, integer, integer) from authenticated;
grant execute on function public.take_rate_limit(text, text, integer, integer) to service_role;

create table public.tpe_delivery_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.tpe_businesses(id) on delete cascade,
  estimate_id uuid not null references public.tpe_estimates(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  recipient text not null check (btrim(recipient) <> ''),
  action text not null check (btrim(action) <> ''),
  stage text not null check (btrim(stage) <> ''),
  status text not null default 'claimed' check (status in ('claimed', 'sent')),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint tpe_delivery_claims_once unique (
    business_id, estimate_id, channel, recipient, action, stage
  )
);

alter table public.tpe_delivery_claims enable row level security;

create or replace function public.claim_delivery(
  p_business_id uuid,
  p_estimate_id uuid,
  p_channel text,
  p_recipient text,
  p_action text,
  p_stage text
) returns table (claim_id uuid, claimed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_claim_id uuid;
begin
  insert into public.tpe_delivery_claims (
    business_id, estimate_id, channel, recipient, action, stage
  ) values (
    p_business_id, p_estimate_id, p_channel, p_recipient, p_action, p_stage
  )
  on conflict on constraint tpe_delivery_claims_once do nothing
  returning id into v_claim_id;

  return query select v_claim_id, v_claim_id is not null;
end;
$$;

create or replace function public.mark_delivery_sent(p_claim_id uuid)
returns void
language sql
set search_path = public
as $$
  update public.tpe_delivery_claims
     set status = 'sent', sent_at = now()
   where id = p_claim_id;
$$;

revoke all on function public.claim_delivery(uuid, uuid, text, text, text, text) from public;
revoke all on function public.claim_delivery(uuid, uuid, text, text, text, text) from anon;
revoke all on function public.claim_delivery(uuid, uuid, text, text, text, text) from authenticated;
grant execute on function public.claim_delivery(uuid, uuid, text, text, text, text) to service_role;

revoke all on function public.mark_delivery_sent(uuid) from public;
revoke all on function public.mark_delivery_sent(uuid) from anon;
revoke all on function public.mark_delivery_sent(uuid) from authenticated;
grant execute on function public.mark_delivery_sent(uuid) to service_role;

comment on table public.tpe_delivery_claims is
  'Service-role-only durable pre-provider delivery claims. A duplicate request cannot obtain the same business, estimate, channel, recipient, action, and stage claim.';
