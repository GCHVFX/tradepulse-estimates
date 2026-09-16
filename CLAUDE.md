# TradePulse Estimates — Claude Code Context

TradePulse Estimates turns a short job description into a professional estimate in seconds. Mobile-first. Built for contractors in the field.

---

## Critical Rules

- Never sign up a test/throwaway account by hand through `/signup`. This project's `.env.local` runs a LIVE Stripe key, not test mode, any signup creates a real Stripe Customer and Subscription. Always use the `signUpFreshAccount()` helper in `tests/smoke/helpers.ts` (its safety gate lives in `tests/smoke/smoke-safety.ts`) for any testing that requires an authenticated account, and clean it up the same way the smoke suite does. See DECISIONS.md for the incident this rule came from.

---

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Supabase (database + auth)
- Twilio (SMS), Resend (email)
- Anthropic API, `claude-haiku-4-5-20251001` for estimate generation
- Stripe (subscriptions, CA$29/month Starter, CA$59/month Pro, 14-day free trial)
- Vercel (hosting), Sentry (errors), PostHog (analytics)
- Google Places API (review link lookup in profile)

---

## Development Rules

- Server components by default, client components only when interactivity requires it
- Always output complete files, not partial snippets
- Mobile-first always
- Keep components focused. One responsibility per component.
- Prefer simple solutions over complex patterns
- No `any` — use `unknown` and narrow

---

## Scalability Principles

TradePulse should scale from early validation to thousands of subscribers without a platform rewrite.

Do not over-engineer for scale too early, but avoid choices that make scale painful later.

### Keep `plan` separate from `subscription_status`

Never use `subscription_status` for feature access.

Use:

- `plan = 'starter' | 'pro'`
- `subscription_status = 'trial' | 'active' | 'past_due' | 'cancelled' | 'complimentary'`

Feature access must use:

```ts
business.plan === "pro"
```

Subscription access (can they use the app at all) uses the one shared
predicate in `lib/subscription-access.ts`. Never rewrite the rule inline — it
was independently duplicated across nine files until 2026-08-28, which is how
the gate and the profile badge ended up disagreeing:

```ts
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";

const { data: business } = await supabaseAdmin
  .from("tpe_businesses")
  .select(SUBSCRIPTION_ACCESS_COLUMNS) // plan, subscription_status, trial_ends_at, stripe_subscription_id
  .eq("owner_user_id", user.id)
  .maybeSingle();

if (!hasSubscriptionAccess(business)) { /* this route's own denial response */ }
```

Always select via `SUBSCRIPTION_ACCESS_COLUMNS`: the predicate reads `plan`
and `stripe_subscription_id` as well, and a route that omits them still
compiles while silently denying a paying Pro customer.

`hasSubscriptionAccess()` grants access for a resolved status of `active` or
`complimentary`, and for `trial` only while `trial_ends_at` is in the future.
The *resolved* status comes from `resolveSubscriptionStatus()` in that same
file, which treats `plan === "pro"` + `subscription_status === "trial"` + a
live `stripe_subscription_id` as `active` (Pro is paid up front and never has
a real trial). The profile badge reads the same resolver, so the gate and the
UI cannot disagree. `tests/smoke/subscription-access.spec.ts` fails the build
if any file outside the helper compares `subscription_status` or does
`trial_ends_at` date math for an access decision.

Pro Payments entitlement is `hasProPaymentsAccess()` in `lib/auth.ts` — the
`plan === "pro"` check *composed with* the predicate above, not a second copy
of it.

---

## Folder Structure

```
app/
  new/page.tsx                   Estimate creation + streaming (client)
  estimates/page.tsx             Estimate list (server)
  estimates/[id]/page.tsx        Estimate detail (server)
  share/[id]/page.tsx            Public estimate view, no auth (server)
  payments/page.tsx              Outstanding invoices list (server, Pro-gated)
  profile/page.tsx               Business profile
  onboarding/page.tsx            First-run business setup; creates missing starter trial business row if needed
  rates/page.tsx                 Price book
  subscribe/page.tsx             Paywall / trial expired
  login/page.tsx                 Email/password sign in (public)
  signup/page.tsx                Account creation; starter default, pro via ?plan=pro (public)
  reset-password/page.tsx        Password reset request/confirm (public)
  demo/page.tsx                  Public demo page
  go/
    electricians-postcard/page.tsx  UTM postcard redirect → /electricians
    trades-postcard/page.tsx        UTM postcard redirect → /trades
  plumbers/page.tsx              SEO landing page
  electricians/page.tsx          SEO landing page
  trades/page.tsx                SEO landing page
  plumbing-cost/page.tsx         SEO cost guide
  electrical-cost/page.tsx       SEO cost guide
  plumbing-estimate-template/page.tsx  SEO template landing page
  privacy/page.tsx               Privacy policy (public)
  terms/page.tsx                 Terms of service (public)
  components/                    Shared UI components (see below)
  api/                           Route handlers (see below)
  auth/callback/route.ts         Supabase auth code exchange
  auth/google/route.ts           Google OAuth sign-in start/callback
lib/
  supabase-server.ts             supabaseAdmin, createApiClient, createSupabaseServerClient
  supabase-browser.ts            createSupabaseBrowserClient
  stripe.ts                      Single Stripe instance (import from here only)
  auth.ts                        checkUserSubscriptionAccess(userId, supabaseAdmin)
  audit-log.ts                   logEstimateChange() — writes to tpe_estimate_changes
  api-utils.ts                   validateContentType(), generateRequestId(), addRequestIdToResponse()
  rate-limit.ts                  checkRateLimit() — DB-backed, uses tpe_rate_limits table
  format-phone.ts                Canadian phone formatting
  generate-pdf.ts                jsPDF estimate rendering
  contractor-pricing.ts          The one deterministic pricing calculation. Pure. Never duplicate it.
  contractor-pricing-request.ts  Parses and validates the pricing save payload into canonical rows
  contractor-pricing-form.ts     Field rules for the contractor pricing editor
  generated-estimate.ts          What generation sends the model, and the row it writes
  estimate-prose.ts              Price-safety filter for model prose, plus stripTitleHeading()
  estimate-delivery.ts           isDelivered() — the one delivery rule
  estimate-tax.ts                businessTax(), resolveEstimateTax(), taxAuthorityFor()
  subscription-access.ts         hasSubscriptionAccess(), SUBSCRIPTION_ACCESS_COLUMNS
  database.types.ts              Generated from live schema. Do not edit manually.
  hooks/
    use-business-profile.ts      Shared profile hook — logoUrl, businessName, businessEmail, preparedBy, isPro, googleReviewLink, isLoading
proxy.ts                         Auth + subscription middleware (NOT middleware.ts)
docs/
  SCALING-NOTES.md               Scaling assumptions and future hardening notes
```

---

## What Is Built (Current State)

### Starter Features (live)

- Estimate creation: text input (or photos, or dictation) → AI writes the job wording only → saved as a `contractor_pricing` draft → contractor enters the pricing
- Estimate list, detail, edit, delete
- Send estimate: SMS (Twilio), email (Resend), copy link, PDF download
- Business profile: name, phone, email, logo, prepared_by
- Price book: labour rate, markup %, deposit %, common line items
- Customer details on estimates (editable after generation)
- Stripe subscription + 14-day free trial, no card required
- Billing portal (shown on profile only when subscription_status === 'active')

### Reviews Feature (live, Pro-gated)

- `mark-job-done-sheet.tsx` — bottom sheet triggered from estimate detail after marking done
- Sends Google review request via SMS using Twilio
- Custom message editable before send, Google review link appended automatically
- Tracks `review_requested_at` on `tpe_estimates`, allows resend with confirmation
- Profile has Google review link field with Google Places API lookup helper
- Gated by `business.plan === 'pro'` in `estimates/[id]/review-request/route.ts`
- "Mark Job Done" button only shown on estimate detail when `isPro === true` and status === 'sent'

### Photo Input (live, Starter capped / Pro unlimited)

- Camera icon in the twin-action row attached to the job description textarea in `app/new/page.tsx` FormView (mic + camera, both 44px circles overlapping the textarea's bottom-right corner)
- Tapping camera opens `PhotoSourceSheet` (`photo-source-sheet.tsx`) — choice of Take Photo or Choose from Camera Roll, up to 5 photos, optional per-photo note
- Each photo is downscaled client-side (1568px max edge, JPEG) then sent to `POST /api/analyze-photo`
- Route accepts `{ photos: [{ base64, mediaType, note }] }` (1 to 5 photos), sends them to `claude-sonnet-4-6` (vision), returns one consolidated plain-English job description that populates the textarea — existing Generate flow unchanged
- Photos sent to `/api/analyze-photo` are never stored. No DB columns involved. This is separate from estimate photos attached later via `POST /api/estimates/[id]/photos`, which are stored in `tpe_estimate_photos` and the `tpe-estimate-photos` bucket.
- **Starter**: `STARTER_MONTHLY_PHOTO_LIMIT` (3, `lib/rate-limit.ts`) AI photo estimates per calendar month, enforced server-side in `/api/analyze-photo` before the Anthropic call via `checkRateLimit` keyed by `business.id`, action `analyze-photo-monthly`, window computed by `secondsUntilNextMonthUTC()` so it resets on the UTC calendar month boundary rather than a rolling 30 days. **Pro**: unlimited (this check is skipped entirely for `plan === 'pro'`).
- `GET /api/profile` includes `ai_photo_estimates_remaining` (Starter: a number; Pro: `null`, meaning unlimited) via `useBusinessProfile()`. FormView shows "X of 3 AI photo estimates left this month" once Starter is under the cap, and blocks the camera tap client-side with an upgrade-to-Pro message once it hits 0 — client-side is UX only, the server route is the actual gate and cannot be bypassed by calling the API directly.
- Rate limited: 5 calls per user per 60 minutes (separate short-window abuse throttle, applies to both plans, unchanged by the monthly cap above)

### Dictation (live, all plans)

- Mic icon in the same twin-action row as Photo Input, attached to the job description textarea in `app/new/page.tsx` FormView
- Tap to start recording (`MediaRecorder`, `audio/webm` or `audio/mp4` depending on browser), tap again to stop; auto-stops at 120 seconds
- Recorded clip is sent to `POST /api/transcribe-audio`, which transcribes it via Gemini (`gemini-3.5-flash`, `@google/genai`) and appends the result to the existing job description text
- Not Pro-gated — available on Starter and Pro; requires `GEMINI_API_KEY` env var
- Rate limited: 20 calls per user per 60 minutes via `tpe_rate_limits`
- No audio is stored

### Payments Feature (live, Pro-gated)

- Contractor marks a done estimate as invoiced (`invoice-sheet.tsx`, amount + due date), TradePulse sends automated reminders until marked paid. No payment processing, no Stripe Connect.
- Reminder stages: pre-due (due minus 2 days), first overdue (due plus 1 day), second overdue (due plus 5 days), then ongoing weekly reminders (`overdue_ongoing`) starting at due plus 14 days until paid. One reminder per stage, tracked via `reminder_count` on `tpe_estimates` (counts above 3 are weekly reminders). Reminders stop when `payment_status = 'paid'`.
- `GET /api/cron/payment-reminders` — daily Vercel cron (17:00 UTC, `vercel.json`), secured by `Authorization: Bearer CRON_SECRET`. Sends SMS (Twilio) and email (Resend) per stage, logs each send to `tpe_payment_reminders`.
- `PATCH /api/estimates/[id]/invoice` — sets `invoice_amount`, `due_date`, `payment_status = 'unpaid'`, resets `reminder_count`
- `PATCH /api/estimates/[id]/mark-paid` — sets `payment_status = 'paid'`, `completed_at`
- Estimate detail: "Mark as Invoiced" (status done, no invoice yet) and "Mark as Paid" (unpaid invoice, inline confirm) in `estimate-actions.tsx`
- `/payments` page lists unpaid/overdue invoices, Pro-gated with upgrade prompt for Starter. Not in the bottom nav (freed up the slot — Payments is a filtered view of estimate data, not a separate domain); reached via an "Unpaid Invoices" pill above the list on `/estimates`, which shows a live count for Pro and a "PRO" badge for Starter.
- `payment_link` field on profile (PayPal link or e-transfer email) is included in reminders; omitted cleanly when not set
- Requires `CRON_SECRET` env var

### Contractor-owned pricing (Phase 1, in progress on `phase1-contractor-pricing`)

`specs/contractor-owned-pricing.md` is the authority. Local only, not deployed.

- The AI writes the job wording. It authors no number that changes the selling price.
- A generated estimate saves as `source='ai_generated'`, `status='draft'`, `pricing_source='contractor_pricing'`, with the business tax and deposit settings snapshotted onto the row and **no pricing rows**. It is deliberately incomplete until the contractor prices it. That is correct, not a regression.
- The contractor enters labour, materials, markup and optional charges in the pricing editor on the saved estimate. `lib/contractor-pricing.ts` does the arithmetic, and it is the only implementation of it.
- `/new` renders the saved sanitized prose the server returns, never its own stream buffer.
- Regenerate replaces the wording on the same estimate id. Pricing rows, snapshots, customer details and photos survive.

### Not Yet Built

- Customer output and delivery locking for contractor pricing (Phase 1 slice 5)
- Follow-Up (scheduled customer outreach)
- Pro upgrade flow (no Pro subscribers yet, STRIPE_PRO_PRICE_ID not set)

---

## Domains

Canonical host: **https://tradepulse-estimates.com** (apex, no www).

`lib/site-url.ts` is the single source of truth. Nothing else in the repo
carries a TradePulse hostname.

- `SITE_URL` — runtime origin. `NEXT_PUBLIC_APP_URL`, then the Vercel
  deployment URL for previews, then localhost in development, then the
  canonical host. Used for share links, Stripe redirect URLs, the password
  reset redirect, and the Twilio signature URL.
- `CANONICAL_URL` / `CANONICAL_DOMAIN` — always the real domain, never a
  preview or localhost origin. Used for `metadataBase`, canonical tags, Open
  Graph and Twitter URLs, JSON-LD, the sitemap, `robots.ts`, the OG image
  text, and public marketing links.

These alias hosts 301 to the canonical host and stay attached permanently:
`www.tradepulse-estimates.com`, `tradepulseestimates.com`,
`www.tradepulseestimates.com`, `trytradepulse.com`, `www.trytradepulse.com`.
Estimate share links and printed postcard QR codes still in circulation point
at `trytradepulse.com`, so it must never be detached.

**Email has not moved.** Every `from:` and the published support address are
still on `trytradepulse.com`, held in `lib/email-addresses.ts`. The Resend
sending domain has to be added, verified, and warmed up before they change.
That switch is one edit to `EMAIL_DOMAIN` in that file.

## Routing

- `/` — public landing page (light theme)
- `/new` — estimate creation
- `/estimates` — estimate list
- `/estimates/[id]` — estimate detail
- `/share/[id]` — public estimate (no auth)
- `/payments` — outstanding invoices (Pro-gated in page, upgrade prompt for Starter)
- `/go/*` — postcard QR redirect pages (public, no auth)
- `/plumbers`, `/electricians`, `/trades` — trade-specific landing pages (public)
- `/plumbing-cost`, `/electrical-cost` — SEO cost guides (public)
- `/demo` — public demo page
- All app routes gated by `proxy.ts` (Next.js 16 proxy file, not `middleware.ts`), exported function must be named `proxy`
- `/subscribe` redirects users with access to `/estimates` (not `/new`)

Public paths are listed in `proxy.ts PUBLIC_PATHS`. Every `/api/` path is already public via the `isPublic()` function — do not add individual API routes to PUBLIC_PATHS.

---

## Database Tables (Supabase, `tpe_` prefix)

**`tpe_businesses`**
`id` (uuid PK), `owner_user_id` (FK to auth.users), `name`, `phone`, `email`, `logo_url`, `prepared_by`, `google_review_link`, `payment_link`, `plan` ('starter'|'pro', default 'starter'), `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `signup_source`
Pricing columns (the price book "rates"): `labour_rate`, `markup_percent`, `deposit_percent`, `deposit_threshold`, `tax_label` (default 'GST'), `tax_rate` (default 5)

**`tpe_estimates`**
`id`, `business_id` (FK to tpe_businesses.id), `title`, `summary` (the estimate prose; for a `contractor_pricing` estimate this is prose only and carries no pricing), `status` ('draft'|'sent'|'done'|'needs_review'), `source` ('ai_generated'|'app'|'website_quote'), `customer_name`, `customer_phone`, `customer_email`, `job_address`, `prepared_by`, `deposit_amount`, `sent_via`, `sent_at`, `copied_at`, `completed_at`, `review_requested_at`, `created_at`, `updated_at`
Inbound website-quote columns: `description`, `service_type`, `location`, `urgency`
Photos: `include_photos` (boolean), controls whether attached photos render on the share page and in the PDF
Payments columns: `payment_status`, `invoice_amount`, `due_date`, `last_reminder_sent_at`, `reminder_count`
`pricing_source` ('markdown'|'structured'|'contractor_pricing', default 'markdown', check-constrained). Phase 1 classification, evaluated top down: `contractor_pricing` is the current model; `source='website_quote'` with `status='needs_review'` is unpriced inbound intake; everything else is legacy and read-only. The default stays 'markdown' so an inbound quote, which has no contractor-authored price, never defaults into `contractor_pricing`.
Pricing snapshots, copied from `tpe_businesses` at estimate creation so a later change to Rates cannot move an estimate that already exists: `tax_label_snapshot`, `tax_rate_snapshot`, `deposit_percent_snapshot`, `deposit_threshold_snapshot` (all nullable).
`customer_pricing_mode` ('detailed'|'grouped', default 'detailed', check-constrained): **not used by any code.** Grouped customer pricing is obsolete for new estimates.
Unused columns, present in the schema but never read or written by app code: `scope`, `assumptions`, `payment_terms`, `notes`. That content lives inside `summary`.
There is no `customer_id` column.

**`tpe_estimate_items`**
`id`, `estimate_id` (FK to tpe_estimates, ON DELETE CASCADE), `description`, `item_type` ('labour'|'material'|'service'|'allowance'|'other'), `is_allowance`, `quantity`, `unit`, `unit_price`, `line_total`, `labour_hours`, `labour_rate`, `markup_percent`, `group_label`, `customer_visible`, `display_order`, `taxable`, `created_at`, `updated_at`
**This is the source of truth for contractor pricing.** One row per pricing input, written only by `PUT /api/estimates/[id]/pricing`. The AI never writes to this table. Encoding: hourly labour is `item_type='labour'` with `unit='hr'`, quantity hours and unit_price the rate; fixed labour is the same with `unit=null`, quantity 1 and unit_price the amount; materials are `item_type='material'`, quantity 1, unit_price the pre-markup cost, with the applied percentage on `markup_percent`; an optional charge is `item_type='other'`, quantity 1. No row means unknown and blocks delivery; a row holding 0 is a deliberate zero and is valid.
Money and quantities are `numeric`, never floating point. Percentages are whole numbers (20 means 20%). `line_total` is written by the calculation module and is never read back as authority. `labour_hours` and `labour_rate` are redundant with quantity/unit_price and stay null. See `specs/contractor-owned-pricing.md` and `TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md`.

**`tpe_estimate_photos`**
`id`, `estimate_id` (FK to tpe_estimates), `storage_path`, `original_filename`, `mime_type`, `file_size`, `created_at`, `updated_at`. Photo metadata, files in the private `tpe-estimate-photos` bucket, served via signed URLs. There is no `note` or `file_name` column.

**`tpe_pricebook_items`**
`id`, `business_id` (FK to tpe_businesses.id), `name`, `description`, `category`, `labour_price`, `material_price`, `created_at`
Note: `/api/generate-estimate` injects only `name` and `labour_price` into the prompt. `description` and `material_price` are stored but never reach generation.

**`tpe_estimate_line_items`**
`id`, `estimate_id` (FK to tpe_estimates), `description`, `quantity`, `unit_price`, `line_type`, `created_at`
**Unused.** No application code reads or writes this table. Line items are stored as a markdown pipe table inside `tpe_estimates.summary` and parsed by `lib/estimate-summary.ts`.

**`tpe_estimate_changes`**
`id`, `estimate_id` (FK to tpe_estimates), `user_id`, `change_type` ('created'|'edited'|'sent'|'deleted'), `old_value`, `new_value`, `changed_at`, `created_at` — audit log, written by `lib/audit-log.ts logEstimateChange()`
In practice only `'sent'` is ever written, from `/api/send-sms` and `/api/send-email`. Create, edit, and delete are not logged.

**`tpe_payment_reminders`**
`id`, `estimate_id` (FK to tpe_estimates), `business_id`, `channel`, `stage`, `message`, `sent_at`

**`tpe_rate_limits`**
`key`, `action`, `count`, `expires_at`, `created_at` — used by `lib/rate-limit.ts`

All tables: uuid primary keys, RLS enabled.

**Critical field names:**

- `tpe_businesses` uses `id` as PK and `owner_user_id` to link to auth.users
- Business name field is `name` not `company_name`
- `tpe_estimates` uses `business_id` referencing `tpe_businesses.id` (not auth.users)
- Estimate content column is `summary` not `content`
- Address field is `job_address` not `customer_address`

`lib/database.types.ts` is generated from the live schema. Do not edit manually.
To regenerate: use the Supabase MCP tool `Supabase:generate_typescript_types` (do not use CLI — it hangs on interactive auth). Filter output to `tpe_` prefixed tables only before writing to `lib/database.types.ts`.

---

## Supabase Clients

- `supabaseAdmin` — service role, bypasses RLS, server only (`@/lib/supabase-server`)
- `createSupabaseServerClient()` — SSR anon client for server components (`@/lib/supabase-server`)
- `createApiClient(request)` — request-scoped anon client for API routes (`@/lib/supabase-server`)
- `createSupabaseBrowserClient()` — browser client for client components (`@/lib/supabase-browser`)

Never import from `@supabase/auth-helpers-nextjs`. Always use `@supabase/ssr`.
Never use `.single()`. Use `.maybeSingle()`.
Never use `supabase.auth.getSession()` server-side. Always use `getUser()`.

---

## Auth Pattern

```typescript
// API routes (request-scoped)
const { supabase, applyTo } = createApiClient(request);
const { data: { user } } = await supabase.auth.getUser();
if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

// Server components
const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
```

### proxy.ts (request interceptor)

proxy.ts uses its own `supabaseAdmin` (service role, created inline via `createClient`) for the business/subscription query. This bypasses RLS to avoid null-business results that caused a redirect loop when using the anon client. The anon client (with user cookies) is still used for `getUser()` to handle session token refresh.

---

## Stripe

Import only from `@/lib/stripe`. Never instantiate `new Stripe()` directly in route files.

```ts
import { stripe } from "@/lib/stripe";
```

- CA$29/month Starter plan, CA$59/month Pro plan, 14-day free trial, no card required upfront
- `trial_ends_at` + `subscription_status` (default: `'trial'`) tracked in DB
- `plan` defaults to `'starter'` at signup, set explicitly in `auth/signup/route.ts`
- Webhooks sync subscription status — `amount_paid > 0` guard in `invoice.payment_succeeded`
- Billing portal accessible from Profile page only when `subscription_status === 'active'`
- `STRIPE_PRO_PRICE_ID` env var not yet set — Pro plan not yet launched

---

## API Routes

**Estimates**

- `GET /api/estimates` — list user's estimates (id, title, status, customer_name, created_at)
- `PATCH /api/estimates` — update estimate fields (selective — only fields present in body are updated)
- `DELETE /api/estimates?id=` — delete estimate
- `POST /api/generate-estimate` — streams AI prose, saves to `tpe_estimates`
  - Rate limited: 10 calls per user per 60 seconds via `tpe_rate_limits` table
  - Input `jobDescription` capped at 2000 characters; optional `photoAnalysis` capped at 4000
  - Reads no `labour_rate`, no `markup_percent` and no price book. A value this route never loads cannot reach the model.
  - Saves explicitly as `source='ai_generated'`, `status='draft'`, `pricing_source='contractor_pricing'`, and snapshots the business tax and deposit settings onto the row. It writes no pricing rows.
  - Optional `estimateId` regenerates the wording on that estimate instead of inserting a new one. The write is title and summary only, so pricing rows, snapshots, customer details and photos survive. Refused for anything that is not an undelivered `contractor_pricing` estimate the caller owns.
  - Stream markers, in order: `__ID__` then `__SAVED__` (the saved sanitized prose, which is what `/new` renders). `controller.close()` must come AFTER both are enqueued.
- `POST /api/estimates/[id]/review-request` — sends Google review SMS via Twilio, Pro-gated
- `PATCH /api/estimates/[id]/invoice` — sets invoice amount + due date, starts payment reminders
- `PATCH /api/estimates/[id]/mark-paid` — marks invoice paid, stops reminders
- `POST /api/estimates/[id]/photos` — uploads estimate photos to the `tpe-estimate-photos` bucket, writes `tpe_estimate_photos` metadata
- `DELETE /api/estimates/[id]/photos` — removes an estimate photo (storage object + `tpe_estimate_photos` row)
- `GET /api/cron/payment-reminders` — daily reminder cron, auth via `Authorization: Bearer CRON_SECRET` (not user auth)
- `POST /api/analyze-photo` — vision analysis of 1 to 5 job site photos, Pro-gated
  - Accepts `{ photos: [{ base64, mediaType, note }] }` (JPEG/PNG/WebP/GIF, each base64 capped at ~7MB), returns one consolidated `{ description }`
  - Uses `claude-sonnet-4-6`; images are never stored
  - Rate limited: 5 calls per user per 60 minutes via `tpe_rate_limits`
- `POST /api/transcribe-audio` — transcribes a dictated job description, not Pro-gated
  - Accepts `{ audioBase64, mimeType }` (`audio/webm` or `audio/mp4`, base64 capped at ~2MB)
  - Uses `gemini-3.5-flash` (`@google/genai`); requires `GEMINI_API_KEY`; audio is never stored
  - Rate limited: 20 calls per user per 60 minutes via `tpe_rate_limits`

**Profile**

- `GET /api/profile` — returns `tpe_businesses` record (includes `plan`, `subscription_status`, `trial_ends_at`, `google_review_link`)
- `PATCH /api/profile` — upserts all profile fields; always send all fields to avoid overwriting with empty strings
- `POST /api/profile/find-review-link` — Google Places API search, returns ranked `{ matches, hasStrongMatch }`
- `POST /api/upload-logo` — accepts base64 `{ data, type }`, uploads to Supabase Storage `{userId}/logo`, returns `{ url }`

**Price Book**

- `GET /api/price-book` — returns the business pricing settings (labour rate, markup %, deposit %) from `tpe_businesses`
- `PATCH /api/price-book` — updates those business-level pricing fields
- `GET/POST/PATCH/DELETE /api/price-book-items` — CRUD on `tpe_pricebook_items` (common line items)
- `POST /api/price-book-items/import` — bulk import of `tpe_pricebook_items`

**Comms**

- `POST /api/send-sms` — Twilio SMS (`{ to, estimateId }`)
- `POST /api/send-email` — Resend email; do not include `reply_to` / `replyTo` (TypeScript conflict)
- `POST /api/send-reset-email` — password reset email

**Billing**

- `POST /api/billing/checkout` — creates Stripe Checkout session, redirects to Stripe
- `POST /api/billing/portal` — creates Stripe billing portal session, redirects to Stripe
- `POST /api/billing/upgrade` — starts Stripe Checkout to move a Starter user to Pro (guards already-Pro); `GET` redirects to `/subscribe`
- `POST /api/billing/webhook` — Stripe webhook handler (handles subscription.created/updated/deleted, invoice.payment_succeeded)

**Auth / Internal**

- `POST /api/auth/signup` — creates Supabase user + Stripe trial subscription + `tpe_businesses` row
- `POST /api/auth/login` — email/password sign in via `signInWithPassword`
- `GET /auth/google` — starts Google OAuth (`signInWithOAuth`), redirects to `/auth/callback?next=` (default `/onboarding`); note: under `/auth`, not `/api`
- `GET /api/exchange-recovery` — exchanges Supabase auth code for session (password reset flow)
- `POST /api/notify-error` — emails `support@tradepulse-estimates.com` on Anthropic API errors; always returns 200
- `POST /api/webhooks/new-signup` — Supabase auth hook → email notification on new signup; auth via `x-webhook-secret` header

---

## Shared Components

- `EstimateMarkdown` — single source of truth for estimate markdown rendering. Never duplicate. Import from `@/app/components/estimate-markdown`.
- `useBusinessProfile()` — hook returning `{ logoUrl, businessName, businessEmail, preparedBy, isPro, googleReviewLink, isLoading }`. Use in any screen that shows business identity. Never fetch `/api/profile` inside an event handler.
- `MarkJobDoneSheet` — bottom sheet for post-job review request flow. Shown after "Mark Job Done" on estimate detail. Takes `estimateId`, `googleReviewLink`, `reviewRequestedAt`, `isPro`.
- `SendEstimateSheet` — bottom sheet for SMS / email / copy link / PDF. Takes `estimateId`, `currentStatus`, customer fields, business fields.
- `PhotoSourceSheet` — bottom sheet offering Take Photo or Choose from Camera Roll. Takes `isOpen`, `onClose`, `onTakePhoto`, `onChooseFromLibrary`.
- `EstimateActions` — fixed bottom action bar on estimate detail. Manages Send, Mark Job Done, and review request state. Positioned `bottom-[90px]` (nav measures 93.5px tall; 90px is a deliberate small overlap, not an exact match, so a 1px rounding difference can't reopen a gap) — if the nav's own layout ever changes height, remeasure and update this offset too. A previous mismatch (102px vs. 93.5px) left an 8.5px gap that exposed the scrolling page content behind both fixed bars.
- `CustomerDetailsBlock` — editable customer info block on estimate view.
- `CompanyEstimateHeader` — logo + business name header on the white estimate card.

---

## Twilio SMS

Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`
Phone formatting: Canadian numbers. Strip non-digits, add +1 prefix if not present.
SMS pulls `name` from `tpe_businesses` (not `company_name`).
Every Twilio send path (`app/api/send-sms/route.ts`, `app/api/cron/payment-reminders/route.ts`, `app/api/estimates/[id]/send-reminder/route.ts`, `app/api/estimates/[id]/review-request/route.ts`) sends via `lib/twilio-send.ts`'s `resolveTwilioSendAddress()`: when `TWILIO_MESSAGING_SERVICE_SID` is set (blank-checked, not nullish-checked), sends with `messagingServiceSid` and omits `from` (Twilio rejects both together) — the Messaging Service's Advanced Opt-Out management and the number's 10DLC campaign registration are both tied to the service, not to a bare `from` send. Falls back to `TWILIO_FROM_NUMBER` when the SID is absent. Every route's "is SMS configured" gate (`cron/payment-reminders`' and `send-reminder`'s `smsConfigured`, `review-request`'s early-return) checks `hasUsableTwilioSender()` from the same file instead of `TWILIO_FROM_NUMBER` directly, so the gate agrees with what the send call actually needs — true when either env var is set, blank-checked. Two source-level tests (`tests/smoke/twilio-messaging-service.spec.ts`) guard both halves: no route hardcodes `from` outside `lib/twilio-send.ts`, and no route under `app/` references `TWILIO_FROM_NUMBER` directly at all.

---

## Estimate Output Structure

**The AI writes the job. The contractor owns the price. TradePulse owns the maths.**

Every generated estimate is prose only, in this exact structure:

1. Job Title (H1 heading — filtered from rendered output by EstimateMarkdown)
2. Job Summary (2 to 3 sentences)
3. Scope of Work (bullet list, specific tasks, plain language)
4. Assumptions and Exclusions (plain bullets, no bold labels)
5. Notes (job-specific and useful, omit if nothing relevant)

**The model must never author any of these.** There is no Line Items table and no
Pricing Summary in generated output:

- labour hours, labour rates, material prices, markup, tax, deposits, totals
- any other value whose purpose is to decide a selling price
- Payment Terms, estimate validity periods ("valid for 30 days"), warranties,
  cancellation or financing terms, payment due dates or timing, or any other
  contractor business term

Pricing is contractor-owned and calculated deterministically from the structured
rows in `tpe_estimate_items` by `lib/contractor-pricing.ts`. Business terms are
the contractor's own and are added outside the model; there is no setting holding
them yet, so generated output simply does not carry them rather than carrying an
invented default.

`lib/estimate-prose.ts` is the guardrail behind those rules, not a substitute for
them. It runs on model output only, once, before the estimate row is written. It
deletes a sentence carrying a currency figure, a deposit, a pricing hedge
("pricing may change", "quoted separately", "cost will depend") or an invented
business term, deletes a heading its deletions emptied, and drops a Payment Terms
section whole. It never rewrites contractor-typed prose, never retries the model
and never blocks a save.

Photos may help the model understand the job: visible conditions, materials and
components, access difficulty, likely scope, and what belongs in assumptions and
exclusions. Photos must not author a price-driving value. The photo instruction in
`app/api/analyze-photo/route.ts` keeps an observation separate from the action it
calls for: it describes what is visible, does not state an uncertain diagnosis as
fact ("dark staining, possible moisture-related deterioration", not "mould"), does
not call for replacement just because something is visible (inspect, verify, or
replace if damaged), and does not assume an adjacent component has failed.

Customer details are stored as columns on `tpe_estimates` and rendered via `CustomerDetailsBlock`. Not baked into AI output. H1 lines are filtered from markdown rendering. Business name and job title are displayed separately in the UI.

---

## UI Rules

- Large tap targets (minimum 44px)
- One primary action per screen, always visible
- No blank states — always show a default or example
- Progressive disclosure — advanced options hidden until needed
- Primary buttons fixed to bottom on mobile
- No dashboards as entry points
- Max 2 levels of navigation depth
- Bottom nav points to `/new`

---

## Writing Rules (applies to all UI copy and generated text)

- Write like a contractor, not like software
- Short sentences, plain language, Canadian English (labour, colour)
- No em dashes — use a period or comma instead
- No filler transitions: Additionally, Furthermore, Moreover
- No padding: It is important to note, In order to
- No forbidden words: ensure, streamline, leverage, utilize, seamless, comprehensive, facilitate
- Prices specific and labelled, never vague
- Scope descriptions specific, never vague
- UI labels: action verbs, short. Create Estimate, Send Estimate, Edit Items

---

## Claude Chat Conventions

**CC** means Claude Code. When the user says "give this to CC" or "CC prompt", they mean a prompt to paste into the Claude Code extension in VS Code.

**Claude Code prompt format:**
Plain fenced code block only — no buttons, no widgets. Example:

```
In app/components/estimate-markdown.tsx, do X.

1. Find Y and replace with Z.
2. Add this import at the top: ...
```

Never use interactive widgets or custom HTML boxes for CC prompts.

---

# Andrej Karpathy's 5

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet. Before implementing, state the approach in 2 lines and list what it makes harder later.

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. If you see a clearly better approach, say so before implementing. Explain the tradeoff in 2-4 bullets. If the current request is still reasonable, proceed unless the alternative avoids serious risk or wasted work.

<!-- ai-control-centre:managed-block:start v4 -->
## AI Control Centre tracking

This project is tracked by AI Control Centre. Compatible coding agents
(Claude Code, Codex, GLM, Kimi, Antigravity, and others) should:

1. Use this repository's AI Control Centre activity helper at the beginning
   and end of substantial work, recording a session-start and a
   session-complete event.
2. When recording a session, include whichever of these can actually be
   confirmed: the provider, the exact model id, the model's display name,
   and the effort or reasoning level used. Never guess an unavailable
   value; omit the field, or use "Unknown", instead.
3. Give the session a short, descriptive title or reference so it can be
   told apart from other sessions later.
4. Record a concise summary and the exact next action with each recorded
   event.
5. Report only verification that was actually performed. Pass the exact
   commands or checks run via `--verification`, never claim untested
   results.
6. Update HANDOFF.md before the final commit of a session, not after,
   whenever this project's state materially changes.
7. Avoid manually editing `.ai-control-centre/activity.jsonl` or
   `current-session.json` when the helper is available; let the helper
   write them.
8. Follow the AI Control Centre repository's AI_WORKFLOW.md for the
   exact end-of-session order (verify, update HANDOFF.md, record the
   session, refresh or reindex, then commit only if authorized). Do not
   modify HANDOFF.md again after a final, authorized commit.
9. At the start of substantial work, check whether the incoming prompt
   begins with an [AICC]...[/AICC] header. If so, record that source
   browser-chat handoff via the AI Control Centre CLI's `handoff
   record` command before recording your own session (see
   AI_WORKFLOW.md's "Recording a coding-prompt handoff" section).

See the AI Control Centre repository's `docs/agent-integration.md` for
exact commands, including the `--model`, `--model-display-name`,
`--effort`, `--reasoning-level`, and `--verification` flags.

Claude Code specifically: run the commands above via `npm run aicc --` from the AI Control Centre repository, pointing `--project` at this directory. Claude Code does not expose its selected model or effort level through any documented, reliable mechanism a shelled-out command can read. Pass `--model`, `--model-display-name`, and `--effort` explicitly based on what you actually know for this session, or omit them rather than guessing.
<!-- ai-control-centre:managed-block:end -->

## Task Execution and Verification

Complete the full task, including implementation, relevant testing, documentation, commit, deployment, and hosted verification when requested.

Use HANDOFF.md and existing verified results as the starting point. Do not repeat completed audits or retest unaffected systems.

Inspect only the files and behaviour relevant to the requested change unless evidence points to a broader problem.

Do not use subagents unless the task contains genuinely independent work that will save time.

Run targeted verification for the changed behaviour and its realistic regression surface. Do not perform broad repository analysis or external-system audits when they are unrelated to the change.

Keep the final report concise. Report:

- what changed
- verification run and results
- commit and deployment status
- unresolved problems
- exact next action
