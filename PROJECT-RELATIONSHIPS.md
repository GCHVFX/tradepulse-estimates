# Project Relationships

## WARNING

Do not delete, rename, or migrate any Supabase tables without checking BOTH repos:

- C:\web-apps\tradepulse-estimates (this repo)
- C:\web-apps\clearwater-plumbing

Both apps will share the same TradePulse Supabase project after migration.

---

## This Repo

**Name:** TradePulse Estimates (standalone SaaS)
**Purpose:** AI-powered estimate generation for contractors. Multi-tenant SaaS with auth, billing, SMS/email sending, payment reminders.
**Live URL:** trytradepulse.com

## Supabase Project

**Current:** Web Apps (https://hmkkuyznyumhajjqbxpu.supabase.co)
**Long-term:** TradePulse (https://fctequqcwxyhmnjgxixg.supabase.co) — shared with clearwater-plumbing

## Tables Used (current — Web Apps project)

| Table | Usage | Status |
|---|---|---|
| tpe_businesses | Tenant/business record (PK=user_id) | Active, 0 rows (recovered) |
| tpe_estimates | AI-generated estimates (31 columns, full lifecycle) | Active, 0 rows (recovered) |
| tpe_price_book | Per-user pricing settings (labour_rate, markup) | Active, 0 rows |
| tpe_price_book_items | Per-user custom line items (name, unit_price) | Active, 0 rows |
| tpe_estimate_changes | Audit log (INSERT-only) | Active, 0 rows |
| tpe_payment_reminders | Payment reminder log (INSERT-only, cron) | Active, 0 rows |
| tpe_rate_limits | DB-backed rate limiting | Active, 0 rows |
| tpe_customers | Customer records | UNUSED in code |

## Tables Used (target — after migration to TradePulse project)

| Table | Usage | Migration notes |
|---|---|---|
| tpe_businesses | Unified business table (PK=id, owner_user_id for auth) | Schema expansion: add SaaS columns to Clearwater table |
| tpe_estimates | Unified estimates (Clearwater fields + lifecycle fields) | Schema expansion: add 17 lifecycle columns |
| tpe_estimate_photos | Photo metadata (replaces photo_urls array) | New pattern for this app |
| tpe_pricebook_items | Pricebook items (replaces tpe_price_book_items) | Different schema: category, labour_price, material_price |
| tpe_estimate_line_items | Relational line items (replaces line_items JSONB) | New pattern for this app |
| tpe_estimate_changes | Audit log | Create in new project |
| tpe_payment_reminders | Payment reminder log | Create in new project |
| tpe_rate_limits | Rate limiting | Create in new project |

## Legacy Tables to Retire

| Table | Replacement |
|---|---|
| tpe_price_book | Fold settings into tpe_businesses columns |
| tpe_price_book_items | Replace with tpe_pricebook_items |
| tpe_customers | Never used — drop |

## Legacy Columns to Retire (on tpe_estimates)

| Column | Replacement |
|---|---|
| photo_urls (text[]) | tpe_estimate_photos table |
| line_items (jsonb) | tpe_estimate_line_items table |
| pricing (jsonb) | Computed from line items |
| customer_address | Use job_address instead |

## Storage Buckets

**Current (Web Apps project):**

| Bucket | Usage |
|---|---|
| estimate-photos | Public photo storage for estimates |
| logos | Business logo storage |

**Target (TradePulse project):**

| Bucket | Usage |
|---|---|
| tpe-estimate-photos | Unified photo storage (private, signed URLs) |
| logos | Business logo storage |

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

Multi-tenant SaaS. Supabase Auth (email/password + Google OAuth). Each auth.users row maps to one tpe_businesses row via owner_user_id (currently user_id as PK). Subscription gating via proxy.ts middleware.

## Long-Term Direction

Migrate to the TradePulse Supabase project (shared with Clearwater). Adopt the newer Clearwater schema as the canonical architecture:

- tpe_businesses with id PK + owner_user_id for auth
- tpe_estimates with both quote intake and full lifecycle columns
- tpe_pricebook_items replacing tpe_price_book + tpe_price_book_items
- tpe_estimate_photos replacing photo_urls array
- tpe_estimate_line_items available for structured line items

The standalone app's existing features (auth, billing, SMS, email, cron, rate limiting, audit log) will be ported to work with the new schema.

## Migration Status

- Schema expansion: Not started
- Code migration: Not started (35-40 files to update)
- Env var update: Not started
- Verification: Not started
- Web Apps cleanup: Not started (old tables preserved until migration verified)
