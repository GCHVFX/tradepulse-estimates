-- Pending reservations must count their requested files, not merely rows,
-- because one request may reserve up to five photos.
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

  delete from public.tpe_photo_upload_reservations
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
    coalesce(sum(expected_file_count), 0)::integer,
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

revoke all on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) from public;
revoke all on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) from anon;
revoke all on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) from authenticated;
grant execute on function public.reserve_estimate_photo_upload(uuid, uuid, integer, bigint) to service_role;
