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

