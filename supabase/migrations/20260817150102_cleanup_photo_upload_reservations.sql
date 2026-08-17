-- Completed and handled-failure reservations are represented by persisted
-- photos, so remove their temporary row instead of retaining an audit trail.
create or replace function public.release_estimate_photo_upload_reservation(
  p_reservation_id uuid
) returns void
language sql
set search_path = public
as $$
  delete from public.tpe_photo_upload_reservations
   where id = p_reservation_id
     and status = 'reserved';
$$;

revoke all on function public.release_estimate_photo_upload_reservation(uuid) from public;
revoke all on function public.release_estimate_photo_upload_reservation(uuid) from anon;
revoke all on function public.release_estimate_photo_upload_reservation(uuid) from authenticated;
grant execute on function public.release_estimate_photo_upload_reservation(uuid) to service_role;
