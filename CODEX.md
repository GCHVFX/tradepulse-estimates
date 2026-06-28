# TradePulse Codex Context

TradePulse Estimates turns a short job description into a professional estimate in seconds. Mobile-first. Built for contractors in the field.

Use this file before making implementation changes. Also read `docs/SCALING-NOTES.md` before code changes.

---

## Stack

- Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui
- Supabase database and auth
- Anthropic API, `claude-haiku-4-5-20251001` for estimate generation
- Stripe subscriptions, CA$39/month Starter, CA$69/month Pro, 14-day free trial
- Twilio SMS
- Resend email
- Vercel hosting
- Sentry errors
- PostHog analytics
- Google Places API for review link lookup in profile

---

## Development Rules

- Read the relevant Next.js guide in `node_modules/next/dist/docs/` before changing Next.js APIs, routing, caching, proxy, or App Router behavior. This app uses a version with breaking changes.
- Server components by default. Use client components only when interactivity requires it.
- Mobile-first always.
- Keep components focused. One responsibility per component.
- Prefer simple solutions over complex patterns.
- No `any`. Use `unknown` and narrow.
- Do not touch unrelated code. Surface bad code or design smells as separate follow-up work.
- If something is unclear, ask. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption.
- If there is a clearly better approach, explain the tradeoff briefly before implementing unless the user already asked only for the exact change.

---

## Core Product Rule

TradePulse must stay simple.

The core workflow is:

```text
Describe job -> Generate estimate -> Review / edit -> Send
```

Do not add dashboards, heavy setup, or extra navigation unless the user explicitly asks and the product need is clear.

---

## Scalability Principles

TradePulse should scale from early validation to thousands of subscribers without a platform rewrite.

Do not over-engineer for scale too early, but avoid choices that make scale painful later. The current stack is acceptable through early scale if hardened gradually.

Expected hardening path:

- 0-100 subscribers: product validation, onboarding clarity, estimate generation quality, send/review workflows, basic error visibility.
- 100-500 subscribers: estimate pagination, indexes on common query fields, reliable webhook logging, Twilio/Resend error handling, Sentry coverage.
- 500-1,000 subscribers: background-friendly messaging, better rate limits, admin visibility into failed sends, stronger billing state reporting, support tooling.
- 1,000-5,000 subscribers: queued SMS/email sends, retries, delivery tracking, pagination everywhere, audit logging, A2P 10DLC/compliance work, admin tools.
- 5,000-10,000 subscribers: proper background workers, queue monitoring, message throttling, customer support tooling, database performance review, incident/error monitoring, billing reconciliation.

### Keep `plan` separate from `subscription_status`

Never use `subscription_status` for feature access.

Use:

- `plan = 'starter' | 'pro'`
- `subscription_status = 'trial' | 'active' | 'past_due' | 'cancelled' | 'complimentary'`

Feature access must use:

```ts
business.plan === "pro"
```

Subscription access, meaning whether they can use the app at all, uses:

```ts
const isActive = business.subscription_status === "active";
const isTrialing =
  business.subscription_status === "trial" &&
  new Date(business.trial_ends_at) > new Date();
const hasAccess =
  isActive || isTrialing || business.subscription_status === "complimentary";
```

---

## Folder Structure

```text
app/
  new/page.tsx                     Estimate creation + streaming (client)
  estimates/page.tsx               Estimate list (server)
  estimates/[id]/page.tsx          Estimate detail (server)
  share/[id]/page.tsx              Public estimate view, no auth (server)
  payments/page.tsx                Outstanding invoices list (server, Pro-gated)
  profile/page.tsx                 Business profile
  onboarding/page.tsx              First-run business setup
  rates/page.tsx                   Price book
  subscribe/page.tsx               Paywall / trial expired
  demo/page.tsx                    Public demo page
  go/
    electricians-postcard/page.tsx UTM postcard redirect -> /electricians
    trades-postcard/page.tsx       UTM postcard redirect -> /trades
  plumbers/page.tsx                SEO landing page
  electricians/page.tsx            SEO landing page
  trades/page.tsx                  SEO landing page
  plumbing-cost/page.tsx           SEO cost guide
  electrical-cost/page.tsx         SEO cost guide
  components/                      Shared UI components
  api/                             Route handlers
  auth/callback/route.ts           Supabase auth code exchange
lib/
  supabase-server.ts               supabaseAdmin, createApiClient, createSupabaseServerClient
  supabase-browser.ts              createSupabaseBrowserClient
  stripe.ts                        Single Stripe instance. Import from here only.
  auth.ts                          checkUserSubscriptionAccess(userId, supabaseAdmin)
  audit-log.ts                     logEstimateChange(), writes to tpe_estimate_changes
  api-utils.ts                     validateContentType(), generateRequestId(), addRequestIdToResponse()
  rate-limit.ts                    checkRateLimit(), DB-backed via tpe_rate_limits
  format-phone.ts                  Canadian phone formatting
  generate-pdf.ts                  jsPDF estimate rendering
  database.types.ts                Generated from live schema. Do not edit manually.
  hooks/
    use-business-profile.ts        Shared profile hook
proxy.ts                           Auth + subscription request interceptor. Not middleware.ts.
docs/
  SCALING-NOTES.md                 Scaling assumptions and hardening notes
```

---

## What Is Built

### Starter Features

- Estimate creation: text input -> AI streaming -> save to DB
- Estimate list, detail, edit, delete
- Send estimate by SMS, email, copy link, and PDF download
- Business profile: name, phone, email, logo, prepared_by
- Price book: labour rate, markup %, deposit %, common line items
- Customer details on estimates, editable after generation
- Stripe subscription and 14-day free trial, no card required
- Billing portal shown on profile only when `subscription_status === 'active'`

### Reviews Feature, Pro-gated

- `mark-job-done-sheet.tsx` bottom sheet triggered from estimate detail after marking done
- Sends Google review request by SMS using Twilio
- Custom message editable before send, Google review link appended automatically
- Tracks `review_requested_at` on `tpe_estimates`, allows resend with confirmation
- Profile has Google review link field with Google Places API lookup helper
- Gated by `business.plan === 'pro'` in `estimates/[id]/review-request/route.ts`
- "Mark Job Done" button only shown on estimate detail when `isPro === true` and status is `sent`

### Photo Input, Pro-gated

- Camera button below the job description textarea in `app/new/page.tsx` `FormView`
- Photo is downscaled client-side, 1568px max edge JPEG, then sent to `POST /api/analyze-photo`
- Route sends the image to `claude-sonnet-4-6` vision and returns a plain-English job description that populates the textarea
- Existing Generate flow is unchanged
- Photos are never stored. No DB columns involved.
- Gated by `business.plan === 'pro'` server-side. Starter sees the button greyed out with a Pro badge.
- Rate limited: 5 calls per user per 60 minutes

### Payments Feature, Pro-gated

- Contractor marks a done estimate as invoiced with `invoice-sheet.tsx`, amount, and due date.
- TradePulse sends automated reminders until marked paid. No payment processing and no Stripe Connect.
- Reminder stages: pre-due at due minus 2 days, first overdue at due plus 1 day, second overdue at due plus 5 days, then ongoing weekly reminders starting at due plus 14 days until paid.
- One reminder per stage, tracked via `reminder_count` on `tpe_estimates`; counts above 3 are weekly reminders.
- Reminders stop when `payment_status = 'paid'`.
- `GET /api/cron/payment-reminders` runs daily by Vercel cron at 17:00 UTC, secured by `Authorization: Bearer CRON_SECRET`.
- Reminder sends are logged to `tpe_payment_reminders`.
- `PATCH /api/estimates/[id]/invoice` sets `invoice_amount`, `due_date`, `payment_status = 'unpaid'`, and resets `reminder_count`.
- `PATCH /api/estimates/[id]/mark-paid` sets `payment_status = 'paid'` and `completed_at`.
- Estimate detail shows "Mark as Invoiced" and "Mark as Paid" in `estimate-actions.tsx`.
- `/payments` lists unpaid/overdue invoices and is Pro-gated with an upgrade prompt for Starter.
- Payments tab in `bottom-nav.tsx` shows a PRO badge for Starter users.
- `payment_link` on profile, either PayPal link or e-transfer email, is included in reminders and omitted cleanly when not set.
- Requires `CRON_SECRET`.

### Not Yet Built

- Follow-Up, scheduled customer outreach
- Pro upgrade flow. No Pro subscribers yet and `STRIPE_PRO_PRICE_ID` is not set.

---

## Routing

- `/` public landing page, light theme
- `/new` estimate creation
- `/estimates` estimate list
- `/estimates/[id]` estimate detail
- `/share/[id]` public estimate, no auth
- `/payments` outstanding invoices, Pro-gated in page, upgrade prompt for Starter
- `/go/*` postcard QR redirect pages, public, no auth
- `/plumbers`, `/electricians`, `/trades` trade-specific landing pages
- `/plumbing-cost`, `/electrical-cost` SEO cost guides
- `/demo` public demo page
- `/subscribe` redirects users with access to `/estimates`, not `/new`

All app routes are gated by `proxy.ts`. This is Next.js 16 proxy, not `middleware.ts`; the exported function must be named `proxy`.

Public paths are listed in `proxy.ts` `PUBLIC_PATHS`. Every `/api/` path is already public through `isPublic()`. Do not add individual API routes to `PUBLIC_PATHS`.

---

## Database Tables

All app tables use the `tpe_` prefix, uuid primary keys, and RLS enabled.

### `tpe_businesses`

`id` uuid PK, `owner_user_id` FK to auth.users, `name`, `phone`, `email`, `logo_url`, `prepared_by`, `google_review_link`, `payment_link`, `plan` (`starter` or `pro`, default `starter`), `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `signup_source`

### `tpe_estimates`

`id`, `business_id` FK to `tpe_businesses.id`, `title`, `summary`, `status` (`draft`, `sent`, `done`, `needs_review`), `source` (`app`, `website_quote`), `customer_name`, `customer_phone`, `customer_email`, `job_address`, `customer_id`, `prepared_by`, `deposit_amount`, `sent_via`, `sent_at`, `copied_at`, `completed_at`, `review_requested_at`, `created_at`

Payments columns: `payment_status`, `invoice_amount`, `due_date`, `last_reminder_sent_at`, `reminder_count`

### Other Tables

- `tpe_estimate_photos`: `id`, `estimate_id`, `storage_path`, `file_name`, `note`, `created_at`. Files live in `tpe-estimate-photos` bucket.
- `tpe_pricebook_items`: `id`, `business_id`, `name`, `category`, `labour_price`, `material_price`, `created_at`.
- `tpe_estimate_line_items`: `id`, `estimate_id`, `description`, `quantity`, `unit_price`, `line_type`, `created_at`.
- `tpe_estimate_changes`: audit log written by `lib/audit-log.ts` `logEstimateChange()`.
- `tpe_payment_reminders`: `id`, `estimate_id`, `business_id`, `channel`, `stage`, `message`, `sent_at`.
- `tpe_rate_limits`: `key`, `action`, `count`, `expires_at`, `created_at`.

Critical field names:

- `tpe_businesses` uses `id` as PK and `owner_user_id` to link to auth.users.
- Business name field is `name`, not `company_name`.
- `tpe_estimates` uses `business_id` referencing `tpe_businesses.id`, not auth.users.
- Estimate content column is `summary`, not `content`.
- Address field is `job_address`, not `customer_address`.

`lib/database.types.ts` is generated from the live schema. Do not edit manually. To regenerate, use the Supabase MCP tool `Supabase:generate_typescript_types`. Do not use the CLI because it hangs on interactive auth. Filter output to `tpe_` tables only before writing to `lib/database.types.ts`.

---

## Supabase Clients

- `supabaseAdmin`: service role, bypasses RLS, server only, from `@/lib/supabase-server`
- `createSupabaseServerClient()`: SSR anon client for server components, from `@/lib/supabase-server`
- `createApiClient(request)`: request-scoped anon client for API routes, from `@/lib/supabase-server`
- `createSupabaseBrowserClient()`: browser client for client components, from `@/lib/supabase-browser`

Rules:

- Never import from `@supabase/auth-helpers-nextjs`. Always use `@supabase/ssr`.
- Never use `.single()`. Use `.maybeSingle()`.
- Never use `supabase.auth.getSession()` server-side. Always use `getUser()`.

API route auth pattern:

```ts
const { supabase, applyTo } = createApiClient(request);
const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
}
```

Server component auth pattern:

```ts
const supabase = await createSupabaseServerClient();
const {
  data: { user },
} = await supabase.auth.getUser();
```

`proxy.ts` uses its own `supabaseAdmin`, service role created inline via `createClient`, for the business/subscription query. This bypasses RLS to avoid null-business redirect loops when using the anon client. The anon client with user cookies is still used for `getUser()` to handle session token refresh.

---

## Stripe

Import only from `@/lib/stripe`. Never instantiate `new Stripe()` directly in route files.

```ts
import { stripe } from "@/lib/stripe";
```

- CA$39/month Starter plan
- CA$69/month Pro plan
- 14-day free trial, no card required upfront
- `trial_ends_at` and `subscription_status`, default `trial`, tracked in DB
- `plan` defaults to `starter` at signup and is set explicitly in `auth/signup/route.ts`
- Webhooks sync subscription status
- `invoice.payment_succeeded` has an `amount_paid > 0` guard
- Billing portal is accessible from Profile only when `subscription_status === 'active'`
- `STRIPE_PRO_PRICE_ID` is not yet set. Pro plan has not launched.

---

## API Routes

### Estimates

- `GET /api/estimates`: list user's estimates, `id`, `title`, `status`, `customer_name`, `created_at`
- `PATCH /api/estimates`: update only estimate fields present in body
- `DELETE /api/estimates?id=`: delete estimate
- `POST /api/generate-estimate`: streams AI estimate and saves to `tpe_estimates`
- `POST /api/estimates/[id]/review-request`: sends Google review SMS through Twilio, Pro-gated
- `PATCH /api/estimates/[id]/invoice`: sets invoice amount and due date, starts payment reminders
- `PATCH /api/estimates/[id]/mark-paid`: marks invoice paid and stops reminders
- `GET /api/cron/payment-reminders`: daily reminder cron, auth via `Authorization: Bearer CRON_SECRET`, not user auth
- `POST /api/analyze-photo`: vision analysis of job site photo, Pro-gated

`POST /api/generate-estimate` rules:

- Rate limited: 10 calls per user per 60 seconds via `tpe_rate_limits`.
- Input `jobDescription` capped at 2000 characters.
- `controller.close()` must come after the `__ID__` chunk is enqueued.
- Injects price book data, including labour rate, markup, and common items, into the prompt.

`POST /api/analyze-photo` rules:

- Accepts `{ imageBase64, mediaType }`.
- JPEG, PNG, WebP, GIF only.
- Base64 capped at roughly 6MB.
- Returns `{ description }`.
- Uses `claude-sonnet-4-6`.
- Image is never stored.
- Rate limited: 5 calls per user per 60 minutes via `tpe_rate_limits`.

### Profile

- `GET /api/profile`: returns `tpe_businesses`, including `plan`, `subscription_status`, `trial_ends_at`, `google_review_link`
- `PATCH /api/profile`: upserts all profile fields. Always send all fields to avoid overwriting with empty strings.
- `POST /api/profile/find-review-link`: Google Places API search, returns ranked `{ matches, hasStrongMatch }`
- `POST /api/upload-logo`: accepts base64 `{ data, type }`, uploads to Supabase Storage `{userId}/logo`, returns `{ url }`

### Comms

- `POST /api/send-sms`: Twilio SMS, `{ to, estimateId }`
- `POST /api/send-email`: Resend email. Do not include `reply_to` or `replyTo` because of a TypeScript conflict.
- `POST /api/send-reset-email`: password reset email

### Billing

- `POST /api/billing/checkout`: creates Stripe Checkout session and redirects to Stripe
- `POST /api/billing/portal`: creates Stripe billing portal session and redirects to Stripe
- `POST /api/billing/webhook`: Stripe webhook handler for checkout completed, subscription created/updated/deleted, and invoice payment succeeded
- Required Stripe webhook events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`.
- `subscription_status` stores `cancelled` even though Stripe events use `canceled`; normalize at the boundary.
- Stripe Customer Portal cancellation is dashboard configuration. Confirm cancellation is enabled before launch.
- Pro checkout requires `STRIPE_PRO_PRICE_ID`. If it is missing, the UI should show Starter only or a support message instead of a dead Pro button.

### Auth / Internal

- `POST /api/auth/signup`: creates Supabase user, Stripe trial subscription, and `tpe_businesses` row
- `GET /api/exchange-recovery`: exchanges Supabase auth code for session in password reset flow
- `POST /api/notify-error`: emails `support@trytradepulse.com` on Anthropic API errors and always returns 200
- `POST /api/webhooks/new-signup`: Supabase auth hook -> email notification on new signup, auth via `x-webhook-secret` header

---

## Shared Components

- `EstimateMarkdown`: single source of truth for estimate markdown rendering. Never duplicate. Import from `@/app/components/estimate-markdown`.
- `useBusinessProfile()`: returns `{ logoUrl, businessName, businessEmail, preparedBy, isPro, googleReviewLink, isLoading }`. Use anywhere that shows business identity. Never fetch `/api/profile` inside an event handler.
- `MarkJobDoneSheet`: bottom sheet for post-job review request flow. Shown after "Mark Job Done" on estimate detail. Takes `estimateId`, `googleReviewLink`, `reviewRequestedAt`, `isPro`.
- `SendEstimateSheet`: bottom sheet for SMS, email, copy link, and PDF. Takes `estimateId`, `currentStatus`, customer fields, and business fields.
- `EstimateActions`: fixed bottom action bar on estimate detail. Manages Send, Mark Job Done, and review request state.
- `CustomerDetailsBlock`: editable customer info block on estimate view.
- `CompanyEstimateHeader`: logo and business name header on the white estimate card.

---

## Twilio SMS

Env vars:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Phone formatting is Canadian. Strip non-digits and add `+1` prefix if not present.

SMS pulls `name` from `tpe_businesses`, not `company_name`.

---

## Estimate Output Structure

Every generated estimate follows this exact structure:

1. Job Title, H1 heading. Filtered from rendered output by `EstimateMarkdown`.
2. Job Summary, 2 to 3 sentences.
3. Scope of Work, bullet list, specific tasks, plain language.
4. Line Items, labour and materials, pipe table.
5. Assumptions and Exclusions, plain bullets, no bold labels.
6. Pricing Summary, pipe table with subtotal, tax, total, deposit, balance.
7. Payment Terms, 2 to 4 lines, always includes "This estimate is valid for 30 days".
8. Notes, optional, omit if nothing relevant.

Customer details are stored as columns on `tpe_estimates` and rendered with `CustomerDetailsBlock`. They are not baked into AI output. H1 lines are filtered from markdown rendering. Business name and job title are displayed separately in the UI.

---

## UI Rules

- Large tap targets, minimum 44px.
- One primary action per screen, always visible.
- No blank states. Always show a default or example.
- Progressive disclosure. Advanced options hidden until needed.
- Primary buttons fixed to bottom on mobile.
- No dashboards as entry points.
- Max 2 levels of navigation depth.
- Bottom nav points to `/new`.

---

## Writing Rules

Applies to all UI copy and generated text:

- Write like a contractor, not like software.
- Short sentences, plain language, Canadian English.
- Use Canadian spelling, such as labour and colour.
- No em dashes. Use a period or comma instead.
- No filler transitions: Additionally, Furthermore, Moreover.
- No padding: It is important to note, In order to.
- No forbidden words: ensure, streamline, leverage, utilize, seamless, comprehensive, facilitate.
- Prices must be specific and labelled, never vague.
- Scope descriptions must be specific, never vague.
- UI labels should be short action verbs, such as Create Estimate, Send Estimate, Edit Items.

---

## Codex Chat Conventions

When asked to make changes, implement them directly unless the user asks for a plan, asks a code question, or the requested behavior is ambiguous enough that a reasonable assumption would be risky.

When asked for a Claude Code prompt or "CC prompt", provide a plain fenced code block only. No buttons, widgets, or custom HTML boxes.

Example:

```text
In app/components/estimate-markdown.tsx, do X.

1. Find Y and replace it with Z.
2. Add this import at the top: ...
```

---

## Operating Principles

1. Ask, do not assume. When unattended, proceed with the most reasonable interpretation and record the assumption.
2. Use the simplest solution for simple problems and better solutions for harder ones. Do not add flexibility that is not needed yet.
3. Do not touch unrelated code. Surface unrelated smells separately.
4. Flag uncertainty explicitly. Use small, low-risk local experiments when they can clarify a hypothesis.
5. If a clearly better approach exists, say so and explain the tradeoff briefly. Proceed if the current request is still reasonable.
