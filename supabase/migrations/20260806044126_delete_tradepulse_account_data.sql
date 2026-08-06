-- Permanently removes one owned TradePulse business and all tracked dependent
-- application data in a single transaction. Physical Storage objects and the
-- Auth user are deliberately handled by the protected application route: the
-- storage API cannot join a Postgres transaction, and Auth must be deleted last.
--
-- The function is service-role only. The route resolves the authenticated user
-- first, but ownership is verified again under a row lock here so an arbitrary
-- RPC call cannot delete another business.

create or replace function public.tpe_delete_business_account_data(
  p_business_id uuid,
  p_owner_user_id uuid
) returns jsonb
language plpgsql
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
    -- A retry after a completed database transaction is safe. The protected
    -- route still knows the authenticated user and can finish the Auth step.
    return jsonb_build_object('already_deleted', true);
  end if;

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

  -- Rate limits are keyed by the authenticated user id, not the business id.
  -- Keep IP-keyed signup limits untouched.
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

comment on function public.tpe_delete_business_account_data(uuid, uuid) is
  'Atomically deletes one owned TradePulse business and its dependent rows after Storage cleanup. Service-role only; ownership is rechecked under a row lock. Auth deletion is deliberately performed last by the protected application route.';
