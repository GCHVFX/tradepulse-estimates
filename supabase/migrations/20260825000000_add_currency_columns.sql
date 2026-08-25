-- USD/CAD support: estimate currency on businesses, snapshot currency on estimates.
--
-- Additive and backwards compatible. Both columns are NOT NULL with a 'cad'
-- default, so every existing row backfills to 'cad' in the same statement and
-- no separate UPDATE is required. Existing businesses and estimates therefore
-- stay exactly as they are.
--
-- Billing currency is deliberately NOT stored. Stripe locks it to the Customer
-- on the first subscription and is the only authority for it; a second copy
-- here would drift the moment a contractor changed their estimate currency.
--
-- No RLS change. Both tables already have RLS enabled with service-role-only
-- access, matching every other tpe_ table. No SECURITY DEFINER function is
-- added.

alter table public.tpe_businesses
  add column if not exists estimate_currency text not null default 'cad';

alter table public.tpe_estimates
  add column if not exists currency text not null default 'cad';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tpe_businesses_estimate_currency_check'
  ) then
    alter table public.tpe_businesses
      add constraint tpe_businesses_estimate_currency_check
      check (estimate_currency in ('cad', 'usd'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tpe_estimates_currency_check'
  ) then
    alter table public.tpe_estimates
      add constraint tpe_estimates_currency_check
      check (currency in ('cad', 'usd'));
  end if;
end $$;

comment on column public.tpe_businesses.estimate_currency is
  'Currency this business quotes its own customers in. Not the Stripe billing currency.';

comment on column public.tpe_estimates.currency is
  'Immutable snapshot of the business estimate_currency at creation time.';
