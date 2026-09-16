\# TradePulse Scaling Notes



This document records scaling assumptions, future hardening work, and architectural guardrails.



TradePulse does not need a rewrite to reach early scale. The current stack can support early customers and likely thousands of accounts with incremental hardening.



\---



\## Current Stack



\- Next.js App Router

\- Supabase

\- Stripe

\- Twilio

\- Resend

\- Vercel

\- Sentry

\- PostHog



This stack is acceptable. Do not rewrite prematurely.



\---



\## Expected Scale Path



\### 0–100 subscribers



Current architecture is acceptable.



Focus:



\- product validation

\- onboarding clarity

\- estimate generation quality

\- send/review workflows

\- basic error visibility



\### 100–500 subscribers



Still acceptable with basic cleanup.



Add or verify:



\- estimate pagination

\- indexes on common query fields

\- reliable webhook logging

\- Twilio error handling

\- Resend error handling

\- Sentry coverage



\### 500–1,000 subscribers



Requires operational hardening.



Add:



\- background-friendly message architecture

\- better rate limits

\- admin visibility into failed sends

\- stronger billing state reporting

\- better customer support tools



\### 1,000–5,000 subscribers



Do not rely on direct synchronous outbound sends forever.



Needed:



\- queued SMS/email sends

\- retry handling

\- delivery status tracking

\- pagination everywhere

\- stronger audit logging

\- A2P 10DLC/compliance work for SMS

\- dashboard/admin tools for support



\### 5,000–10,000 subscribers



Requires real operations.



Needed:



\- proper background workers

\- queue monitoring

\- message throttling

\- customer support tooling

\- database performance review

\- formal incident/error monitoring

\- billing reconciliation tools



No platform rewrite is assumed if the app is hardened gradually.



\---



\## Core Scaling Rules



\### 1. Separate feature plan from billing state



Feature access:



```text

plan = starter | pro


\---



\## Data Retention for Future Pricing Analysis



A future Pro feature, "Pricing Insights", is recorded in `TRADEPULSE_ESTIMATES_ROADMAP.md`: a contractor's own job history, and an anonymous aggregate TradePulse benchmark. **None of it is being built now**, and nothing in this note authorises benchmark tables, an analytics pipeline, classification columns, a trade or job taxonomy, historical backfill, new AI output fields, or recommendation logic.



The only thing required of the product today is a guardrail: **do not destructively overwrite historical estimate data where it can be avoided.** Future analysis has to be derivable from what was already stored, because the taxonomy that would classify these jobs does not exist yet and should not be invented before there is data to test it against.



Retain, and avoid destroying in place:



\- the original job description and the generated prose

\- retained job photos, where applicable

\- the structured contractor pricing rows in `tpe_estimate_items`

\- the estimate's currency snapshot

\- estimate status and lifecycle transitions

\- timestamps

\- location and region data already stored

\- the final sent, accepted or completed pricing state, where available



This is a retention principle, not a schema requirement. It mostly means preferring an additive change over an in-place overwrite when a cheap choice exists, and noticing when a cleanup would erase the only record of what a job was actually priced at. Phase 1 already follows it: an estimate's tax and deposit settings are snapshotted onto the row rather than read live, and regenerating an estimate replaces its wording without touching its pricing rows.
