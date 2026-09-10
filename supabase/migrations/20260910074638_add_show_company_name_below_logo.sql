alter table public.tpe_businesses
  add column if not exists show_company_name_below_logo boolean not null default true;
