# Project Relationships

## WARNING

Do not delete, rename, or migrate any Supabase tables without checking BOTH repos:

- C:\Work\web-apps\tradepulse-estimates (this repo)
- C:\Work\web-apps\clearwater-plumbing

Both apps share the same TradePulse Supabase project.

---

## This Repo

**Name:** TradePulse Estimates (standalone SaaS)
**Purpose:** AI-powered estimate generation for contractors. Multi-tenant SaaS with auth, billing, SMS/email sending, payment reminders.
**Live URL:** https://www.trytradepulse.com

## Supabase Project

**Current:** TradePulse (https://fctequqcwxyhmnjgxixg.supabase.co) — shared with clearwater-plumbing

## Tables Used

| Table | Usage |
|---|---|
| tpe_businesses | Tenant/business record (PK=id, owner_user_id links to auth.users) |
| tpe_estimates | AI-generated estimates + website quote submissions |
| tpe_estimate_photos | Photo metadata (private storage, signed URLs) |
| tpe_pricebook_items | Per-business pricebook items (category, labour_price, material_price) |
| tpe_estimate_line_items | Relational line items for estimates |
| tpe_estimate_changes | Audit log (INSERT-only) |
| tpe_payment_reminders | Payment reminder log (INSERT-only, cron) |
| tpe_rate_limits | DB-backed rate limiting |

## Storage Buckets

| Bucket | Usage |
|---|---|
| tpe-estimate-photos | Private photo storage for estimates (signed URLs) |
| logos | Business logo storage |

## Ownership Model

- `tpe_businesses.id` is the business primary key (uuid)
- `tpe_businesses.owner_user_id` links to `auth.users` for SaaS login
- `tpe_estimates.business_id` references `tpe_businesses.id` (not auth.users)
- Contractor websites use `TP_BUSINESS_ID` env var to scope quote submissions to a specific `tpe_businesses.id`

## Environment Variables

| Variable | Purpose |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL (client-side) |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key (client-side auth) |
| SUPABASE_SERVICE_ROLE_KEY | Service role key (server-only) |
| SUPABASE_WEBHOOK_SECRET | Supabase webhook verification |
| ANTHROPIC_API_KEY | Claude API for AI estimate generation |
| TWILIO_ACCOUNT_SID | SMS sending |
| TWILIO_AUTH_TOKEN | SMS auth |
| TWILIO_FROM_NUMBER | SMS sender number |
| RESEND_API_KEY | Email sending |
| STRIPE_SECRET_KEY | Stripe billing |
| STRIPE_WEBHOOK_SECRET | Stripe webhook verification |
| STRIPE_PRICE_ID | Stripe price ID (starter plan) |
| NOTIFY_EMAIL | Error notifications |
| CRON_SECRET | Payment reminder cron auth |
| GOOGLE_PLACES_API_KEY | Google Places review link search |
| NEXT_PUBLIC_POSTHOG_KEY | Analytics |
| NEXT_PUBLIC_POSTHOG_HOST | Analytics endpoint |
| SENTRY_AUTH_TOKEN | Error reporting |
| NEXT_PUBLIC_SENTRY_DSN | Error reporting endpoint |

## Auth Model

Multi-tenant SaaS. Supabase Auth (email/password + Google OAuth). Each auth.users row maps to one tpe_businesses row via owner_user_id. Subscription gating via proxy.ts (Next.js 16 proxy, not middleware.ts).

## Contractor Website Integration Pattern

Clearwater Plumbing is the first standalone contractor website using TradePulse as a backend.

**Active Clearwater business ID:** `273169f5-f119-424a-8949-1731ee560f81` (subscription_status = complimentary)

Future contractor websites should follow the same pattern:

- Standalone Next.js site deployed on Vercel
- Same unified TradePulse Supabase project
- Own `TP_BUSINESS_ID` env var scoping all writes to that business
- Quote form creates `tpe_estimates` rows with `source = 'website_quote'`, `status = 'needs_review'`
- Photos upload to `tpe-estimate-photos` bucket, metadata to `tpe_estimate_photos` table
- Quotes appear in the TradePulse app for the contractor to review and edit into real estimates

## Migration Status

- Schema migration to dedicated TradePulse Supabase project: **Complete**
- Code migration (35-40 files updated to new schema): **Complete**
- Old Web Apps Supabase tpe_* tables: **Gone** (legacy/historical only)
- Clearwater production integration: **Complete and verified end-to-end**
- Production fixes: **Complete** (complimentary subscription access, redirect loop, proxy.ts admin client)
