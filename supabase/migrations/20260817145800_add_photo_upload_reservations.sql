-- Reserve business photo capacity before storage writes so concurrent uploads
-- cannot bypass the persisted count and byte quotas.
create table public.tpe_photo_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.tpe_businesses(id) on delete cascade,
  estimate_id uuid not null references public.tpe_estimates(id) on delete cascade,
  expected_file_count integer not null check (expected_file_count between 1 and 5),
  expected_byte_count bigint not null check (expected_byte_count > 0 and expected_byte_count <= 10485760),
  status text not null default 'reserved' check (status in ('reserved', 'released')),
  reserved_at timestamptz not null default now(),
  released_at timestamptz
);

create index tpe_photo_upload_reservations_active_business_idx
  on public.tpe_photo_upload_reservations (business_id, status, reserved_at);

alter table public.tpe_photo_upload_reservations enable row level security;

revoke all on table public.tpe_photo_upload_reservations from public;
revoke all on table public.tpe_photo_upload_reservations from anon;
revoke all on table public.tpe_photo_upload_reservations from authenticated;
grant select, insert, update, delete on table public.tpe_photo_upload_reservations to service_role;

create or replace function public.reserve_estimate_photo_upload(
  p_business_id uuid,
  p_estimate_id uuid,
  p_expected_file_count integer,
  p_expected_byte_count bigint
) returns table (reservation_id uuid, reserved boolean, reason text)
language plpgsql
set search_path = public
as $$
declare
  v_existing_file_count integer;
  v_existing_byte_count bigint;
  v_reserved_file_count integer;
  v_reserved_byte_count bigint;
  v_reservation_id uuid;
begin
  if p_expected_file_count not between 1 and 5
    or p_expected_byte_count <= 0
    or p_expected_byte_count > 10485760 then
    raise exception 'PHOTO_RESERVATION_INVALID_SIZE';
  end if;

  -- Serialise quota reservations per business. The lock lasts only for this
  -- transaction; pending reservations remain counted after it is released.
  perform 1
  from public.tpe_businesses
  where id = p_business_id
  for update;
  if not found then
    raise exception 'PHOTO_RESERVATION_BUSINESS_NOT_FOUND';
  end if;

  perform 1
  from public.tpe_estimates
  where id = p_estimate_id
    and business_id = p_business_id;
  if not found then
    raise exception 'PHOTO_RESERVATION_ESTIMATE_NOT_FOUND';
  end if;

  -- A terminated serverless invocation cannot leave quota permanently held.
  update public.tpe_photo_upload_reservations
     set status = 'released', released_at = now()
   where business_id = p_business_id
     and status = 'reserved'
     and reserved_at < now() - interval '15 minutes';

  select
    count(photo.id)::integer,
    coalesce(sum(photo.file_size), 0)::bigint
  into v_existing_file_count, v_existing_byte_count
  from public.tpe_estimates estimate
  left join public.tpe_estimate_photos photo on photo.estimate_id = estimate.id
  where estimate.business_id = p_business_id;

  select
    count(*)::integer,
    coalesce(sum(expected_byte_count), 0)::bigint
  into v_reserved_file_count, v_reserved_byte_count
  from public.tpe_photo_upload_reservations
  where business_id = p_business_id
    and status = 'reserved';

  if v_existing_file_count + v_reserved_file_count + p_expected_file_count > 100 then
    return query select null::uuid, false, 'photo_limit'::text;
    return;
  end if;

  if v_existing_byte_count + v_reserved_byte_count + p_expected_byte_count > 209715200 then
    return query select null::uuid, false, 'storage_limit'::text;
    return;
  end if;

  insert into public.tpe_photo_upload_reservations (
    business_id,
    estimate_id,
    expected_file_count,
    expected_byte_count
  ) values (
    p_business_id,
    p_estimate_id,
    p_expected_file_count,
    p_expected_byte_count
  ) returning id into v_reservation_id;

  return query select v_reservation_id, true, null::text;
end;
$$;

create or replace function public.release_estimate_photo_upload_reservation(
  p_reservation_id uuid
) returns void
language sql
set search_path = public
as $$
  update public.tpe_photo_upload_reservations
     set status = 'released', released_at = now()
   where id = p_reservation_id
     and status = 'reserved';
$$;

revoke all on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) from public;
revoke all on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) from anon;
revoke all on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) from authenticated;
grant execute on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) to service_role;

revoke all on function public.release_estimate_photo_upload_reservation(uuid) from public;
revoke all on function public.release_estimate_photo_upload_reservation(uuid) from anon;
revoke all on function public.release_estimate_photo_upload_reservation(uuid) from authenticated;
grant execute on function public.release_estimate_photo_upload_reservation(uuid) to service_role;

comment on table public.tpe_photo_upload_reservations is
  'Service-role-only quota reservations held while estimate photos are uploaded and released after the files are recorded or an upload fails.';
