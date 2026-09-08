-- First-party click logging for outreach campaign redirect links.
--
-- Purely additive. One new table, nothing existing is touched. Records one
-- raw click event every time /r/[code] is visited with a recognised campaign
-- code, whether or not the visitor ever signs up. This is deliberately
-- separate from tpe_businesses.outreach_campaign_code (added in
-- 20260907000000_add_outreach_campaign_code.sql), which only reflects
-- signups: that column alone cannot show how many people clicked a campaign
-- link and never converted. This table is the missing top of that funnel.
--
-- HOW THIS IS APPLIED: see the header comment in
-- 20260731000000_create_tpe_estimate_items.sql -- same convention. Applied
-- through the Supabase MCP `apply_migration` tool; this file is the durable
-- in-repo record of the exact SQL that was applied.
--
-- Deliberately minimal: no visitor/session identifier, no IP address, no
-- user agent, no referrer, and no email or name. /r/[code] is reached cold
-- from an outreach email with no existing TradePulse session, so there is no
-- existing anonymous identifier (this app sets no pre-auth visitor cookie)
-- to attach a click to, and this feature does not need per-visitor identity
-- to answer "how many clicks did campaign X get, and what fraction
-- converted" -- a raw count over a date range is enough, and is also the
-- smallest amount of data to hold about someone who has not agreed to
-- anything yet.
--
-- No foreign key to tpe_businesses: a click happens before any business row
-- exists for that visitor, and most clicks are never followed by a signup at
-- all, so there is nothing to reference.

create table if not exists public.tpe_outreach_clicks (
  id            uuid primary key default gen_random_uuid(),
  campaign_code text not null,
  clicked_at    timestamptz not null default now(),

  constraint tpe_outreach_clicks_campaign_code_not_blank
    check (btrim(campaign_code) <> '')
);

-- Supports both query shapes the reporting SQL in HANDOFF.md actually uses:
-- "clicks for campaign X" and "clicks for campaign X within a date range".
create index if not exists tpe_outreach_clicks_campaign_clicked_at_idx
  on public.tpe_outreach_clicks (campaign_code, clicked_at);

-- RLS: enabled, with no policies, matching every existing tpe_ table. The
-- application reaches this table only through the service-role client (the
-- public /r/[code] redirect route, server-only), so this denies anon and
-- authenticated all row access, the same posture as every other tpe_ table.
alter table public.tpe_outreach_clicks enable row level security;

comment on table public.tpe_outreach_clicks is
  'Raw click events for outreach campaign redirect links (/r/[code]). One row per visit with a recognised campaign_code, whether or not the visitor signs up. Written by the service-role client in lib/campaign-attribution.ts. Deliberately holds no IP, user agent, or other visitor-identifying data. Email-security scanners and automated link-preview bots will inflate this count above genuine human visits; there is no bot filtering here by design -- see HANDOFF.md.';
