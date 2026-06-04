# TradePulse Estimates — Claude Code Context

TradePulse Estimates turns a short job description into a professional estimate in seconds. Mobile-first. Built for contractors in the field.

---

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Supabase (database + auth)
- Twilio (SMS), Resend (email)
- Anthropic API, `claude-haiku-4-5-20251001` for estimate generation
- Stripe (subscriptions, CA$39/month Starter, CA$69/month Pro, 14-day free trial)
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

Subscription access (can they use the app at all) uses:

```ts
const isActive = business.subscription_status === "active";
const isTrialing = business.subscription_status === "trial" && new Date(business.trial_ends_at) > new Date();
const hasAccess = isActive || isTrialing || business.subscription_status === "complimentary";
```

---

## Folder Structure

```
app/
  new/page.tsx                   Estimate creation + streaming (client)
  estimates/page.tsx             Estimate list (server)
  estimates/[id]/page.tsx        Estimate detail (server)
  share/[id]/page.tsx            Public estimate view, no auth (server)
  profile/page.tsx               Business profile
  onboarding/page.tsx            Redirects to /new (stub)
  rates/page.tsx                 Price book
  subscribe/page.tsx             Paywall / trial expired
  demo/page.tsx                  Public demo page
  go/
    electricians-postcard/page.tsx  UTM postcard redirect → /electricians
    trades-postcard/page.tsx        UTM postcard redirect → /trades
  plumbers/page.tsx              SEO landing page
  electricians/page.tsx          SEO landing page
  trades/page.tsx                SEO landing page
  plumbing-cost/page.tsx         SEO cost guide
  electrical-cost/page.tsx       SEO cost guide
  components/                    Shared UI components (see below)
  api/                           Route handlers (see below)
  auth/callback/route.ts         Supabase auth code exchange
lib/
  supabase-server.ts             supabaseAdmin, createApiClient, createSupabaseServerClient
  supabase-browser.ts            createSupabaseBrowserClient
  stripe.ts                      Single Stripe instance (import from here only)
  auth.ts                        checkUserSubscriptionAccess(userId, supabaseAdmin)
  api-utils.ts                   validateContentType(), generateRequestId(), addRequestIdToResponse()
  rate-limit.ts                  checkRateLimit() — DB-backed, uses tpe_rate_limits table
  format-phone.ts                Canadian phone formatting
  generate-pdf.ts                jsPDF estimate rendering
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
- Estimate creation: text input → AI streaming → save to DB
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

### Not Yet Built
- Payments (automated invoice reminders)
- Follow-Up (scheduled customer outreach)
- Camera input for estimates (requires Sonnet, Pro only)
- Pro upgrade flow (no Pro subscribers yet, STRIPE_PRO_PRICE_ID not set)

---

## Routing

- `/` — public landing page (light theme)
- `/new` — estimate creation
- `/estimates` — estimate list
- `/estimates/[id]` — estimate detail
- `/share/[id]` — public estimate (no auth)
- `/go/*` — postcard QR redirect pages (public, no auth)
- `/plumbers`, `/electricians`, `/trades` — trade-specific landing pages (public)
- `/plumbing-cost`, `/electrical-cost` — SEO cost guides (public)
- `/demo` — public demo page
- All app routes gated by `proxy.ts` (not `middleware.ts`), exported function must be named `proxy`

Public paths are listed in `proxy.ts PUBLIC_PATHS`. Every `/api/` path is already public via the `isPublic()` function — do not add individual API routes to PUBLIC_PATHS.

---

## Database Tables (Supabase, `tpe_` prefix)

**`tpe_businesses`**
`user_id` (FK to auth.users, PK), `name`, `phone`, `email`, `logo_url`, `prepared_by`, `google_review_link`, `plan` ('starter'|'pro', default 'starter'), `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `signup_source`

**`tpe_estimates`**
`id`, `business_id` (FK to auth.users), `title`, `summary` (full markdown content), `status` ('draft'|'sent'|'done'), `customer_name`, `customer_phone`, `customer_email`, `customer_address`, `prepared_by`, `deposit_amount`, `sent_via`, `sent_at`, `copied_at`, `completed_at`, `review_requested_at`, `created_at`

**`tpe_price_book`**
`user_id`, `labour_rate`, `markup_percent`, `deposit_percent`, `deposit_threshold`

**`tpe_price_book_items`**
`user_id`, `name`, `unit`, `unit_price`, `created_at`

**`tpe_rate_limits`**
`key`, `action`, `count`, `expires_at`, `created_at` — used by `lib/rate-limit.ts`

**`tpe_customers`**
`id`, `business_id`, `name`, `phone`, `email`, `address` — exists in schema, not yet used in queries

All tables: uuid primary keys, RLS enabled.

**Critical field names:**
- `tpe_businesses` uses `user_id` not `id` as the PK/FK
- Business name field is `name` not `company_name`
- `tpe_estimates` uses `business_id` not `user_id` as the ownership FK
- Estimate content column is `summary` not `content`

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

---

## Stripe

Import only from `@/lib/stripe`. Never instantiate `new Stripe()` directly in route files.

```ts
import { stripe } from "@/lib/stripe";
```

- CA$39/month Starter plan, CA$69/month Pro plan, 14-day free trial, no card required upfront
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
- `POST /api/generate-estimate` — streams AI estimate, saves to `tpe_estimates`
  - Rate limited: 10 calls per user per 60 seconds via `tpe_rate_limits` table
  - Input `jobDescription` capped at 2000 characters
  - `controller.close()` must come AFTER the `__ID__` chunk is enqueued
  - Injects price book data (labour rate, markup, common items) into the prompt
- `POST /api/estimates/[id]/review-request` — sends Google review SMS via Twilio, Pro-gated

**Profile**
- `GET /api/profile` — returns `tpe_businesses` record (includes `plan`, `subscription_status`, `trial_ends_at`, `google_review_link`)
- `PATCH /api/profile` — upserts all profile fields; always send all fields to avoid overwriting with empty strings
- `POST /api/profile/find-review-link` — Google Places API search, returns ranked `{ matches, hasStrongMatch }`
- `POST /api/upload-logo` — accepts base64 `{ data, type }`, uploads to Supabase Storage `{userId}/logo`, returns `{ url }`

**Comms**
- `POST /api/send-sms` — Twilio SMS (`{ to, estimateId }`)
- `POST /api/send-email` — Resend email; do not include `reply_to` / `replyTo` (TypeScript conflict)
- `POST /api/send-reset-email` — password reset email

**Billing**
- `POST /api/billing/checkout` — creates Stripe Checkout session, redirects to Stripe
- `POST /api/billing/portal` — creates Stripe billing portal session, redirects to Stripe
- `POST /api/billing/webhook` — Stripe webhook handler (handles subscription.created/updated/deleted, invoice.payment_succeeded)

**Auth / Internal**
- `POST /api/auth/signup` — creates Supabase user + Stripe trial subscription + `tpe_businesses` row
- `GET /api/exchange-recovery` — exchanges Supabase auth code for session (password reset flow)
- `POST /api/notify-error` — emails `support@trytradepulse.com` on Anthropic API errors; always returns 200
- `POST /api/webhooks/new-signup` — Supabase auth hook → email notification on new signup; auth via `x-webhook-secret` header

---

## Shared Components

- `EstimateMarkdown` — single source of truth for estimate markdown rendering. Never duplicate. Import from `@/app/components/estimate-markdown`.
- `useBusinessProfile()` — hook returning `{ logoUrl, businessName, businessEmail, preparedBy, isPro, googleReviewLink, isLoading }`. Use in any screen that shows business identity. Never fetch `/api/profile` inside an event handler.
- `MarkJobDoneSheet` — bottom sheet for post-job review request flow. Shown after "Mark Job Done" on estimate detail. Takes `estimateId`, `googleReviewLink`, `reviewRequestedAt`, `isPro`.
- `SendEstimateSheet` — bottom sheet for SMS / email / copy link / PDF. Takes `estimateId`, `currentStatus`, customer fields, business fields.
- `EstimateActions` — fixed bottom action bar on estimate detail. Manages Send, Mark Job Done, and review request state.
- `CustomerDetailsBlock` — editable customer info block on estimate view.
- `CompanyEstimateHeader` — logo + business name header on the white estimate card.

---

## Twilio SMS

Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
Phone formatting: Canadian numbers. Strip non-digits, add +1 prefix if not present.
SMS pulls `name` from `tpe_businesses` (not `company_name`).

---

## Estimate Output Structure

Every generated estimate follows this exact structure:

1. Job Title (H1 heading — filtered from rendered output by EstimateMarkdown)
2. Job Summary (2 to 3 sentences)
3. Scope of Work (bullet list, specific tasks, plain language)
4. Line Items (labour and materials, pipe table)
5. Assumptions and Exclusions (plain bullets, no bold labels)
6. Pricing Summary (pipe table: subtotal, tax, total, deposit, balance)
7. Payment Terms (2 to 4 lines, always includes "This estimate is valid for 30 days")
8. Notes (optional, omit if nothing relevant)

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
