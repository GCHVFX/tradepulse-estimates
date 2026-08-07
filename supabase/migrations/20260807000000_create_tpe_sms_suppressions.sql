-- SMS opt-out suppression for automated payment-reminder texts.
--
-- Purely additive: one new table, nothing existing is touched.
--
-- HOW THIS IS APPLIED: see the header comment in
-- 20260731000000_create_tpe_estimate_items.sql -- same convention. Applied
-- through the Supabase MCP `apply_migration` tool; this file is the durable
-- in-repo record of the exact SQL that was applied.
--
-- Design: suppression is keyed by phone number alone, not by business or
-- estimate. TradePulse sends every automated SMS (payment reminders, review
-- requests, estimate sends) from one shared TWILIO_FROM_NUMBER, not a
-- per-business Messaging Service (verified by inspecting app/api/send-sms,
-- app/api/cron/payment-reminders, and app/api/estimates/[id]/review-request,
-- which all read the same env var and have no per-business number lookup).
-- Twilio's STOP handling blocks a recipient from that shared number account
-- wide, not per business, so phone-level global suppression is what actually
-- matches Twilio's behaviour. A per-estimate or per-business suppression flag
-- would let a second reminder slip through the same blocked number.
--
-- A row only exists once a phone has been opted out at least once. Absence of
-- a row means "never opted out". Presence with sms_opted_out = false means
-- "was opted out, then opted back in", preserved for audit history rather
-- than deleted.

create table if not exists public.tpe_sms_suppressions (
  id                uuid primary key default gen_random_uuid(),
  phone             text not null unique,
  sms_opted_out     boolean not null default true,
  opted_out_at      timestamptz,
  opted_in_at       timestamptz,
  last_message_sid  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tpe_sms_suppressions_phone_not_blank
    check (btrim(phone) <> '')
);

-- The only read this table will have for a long time: "is this phone
-- currently suppressed". The unique constraint on phone already gives a fast
-- exact-match lookup; no separate index needed.

-- RLS: enabled, with no policies, matching every existing tpe_ table. The
-- application reaches this table only through the service-role client
-- (the inbound Twilio webhook and the payment-reminders cron, both
-- server-only routes), so this denies anon and authenticated all row access,
-- the same posture as every other tpe_ table.
alter table public.tpe_sms_suppressions enable row level security;

comment on table public.tpe_sms_suppressions is
  'Phone-level SMS opt-out state. Keyed by normalized phone (E.164), global across businesses because all outbound SMS shares one Twilio number. Written by the inbound Twilio webhook (STOP/START) and defensively by the payment-reminders cron on Twilio error 21610. Read by the payment-reminders cron before every SMS send and by the estimate detail / payments pages to surface opted-out status to the contractor.';
