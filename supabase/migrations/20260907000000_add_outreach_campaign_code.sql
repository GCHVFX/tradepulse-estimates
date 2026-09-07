alter table public.tpe_businesses
  add column if not exists outreach_campaign_code text null;

comment on column public.tpe_businesses.outreach_campaign_code is
  'Opaque bulk-outreach campaign code captured when the business account is created.';
