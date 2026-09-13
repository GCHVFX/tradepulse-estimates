-- Adds best-effort, coarse click context to tpe_outreach_clicks so future
-- clicks can be evaluated for geography and for likely human vs. scanner/bot
-- origin. Purely additive: five new nullable columns, nothing else changes.
--
-- Deliberately still no visitor/session identifier and no IP address. This
-- does not reverse the "no visitor identifier" decision recorded when this
-- table was created (20260908000000_create_tpe_outreach_clicks.sql) -- none
-- of these five columns identifies a specific person on their own, and none
-- is combined with anything that would. Coarse geography (country/region/
-- city, from Vercel's edge geolocation headers) plus user_agent and referrer
-- is the smallest useful addition to answer "where did this click come
-- from, and does it look like a browser or a scanner" without adding
-- fingerprinting, a third-party geolocation service, or an analytics
-- vendor.
--
-- Historical rows are not backfilled: this data was never captured for them
-- and there is nothing honest to fill in. All five columns are null for
-- every row written before this migration is applied.
--
-- HOW THIS IS APPLIED: see the header comment in
-- 20260731000000_create_tpe_estimate_items.sql -- same convention.

alter table public.tpe_outreach_clicks
  add column if not exists country    text,
  add column if not exists region     text,
  add column if not exists city       text,
  add column if not exists user_agent text,
  add column if not exists referrer   text;

comment on table public.tpe_outreach_clicks is
  'Raw click events for outreach campaign redirect links (/r/[code]). One row per visit with a recognised campaign_code, whether or not the visitor signs up. Written by the service-role client in lib/campaign-attribution.ts. Holds coarse, best-effort click context (country/region/city from Vercel geolocation headers, user_agent, referrer) captured at click time -- never a visitor/session identifier, never a raw IP address. Rows written before 20260912190000_add_outreach_click_metadata.sql have all five as null. Email-security scanners and automated link-preview bots will inflate this count above genuine human visits, and may now be distinguishable by user_agent; there is still no bot filtering or discarding of clicks -- see HANDOFF.md.';
