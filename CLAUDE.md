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

---

## Development Rules

- Server components by default, client components only when interactivity requires it
- Always output complete files, not partial snippets
- Mobile-first always
- Keep components focused. One responsibility per component.
- Prefer simple solutions over complex patterns
- No `any` — use `unknown` and narrow

---

## Folder Structure

```
app/
  new/page.tsx              Estimate creation + streaming (client)
  estimates/page.tsx        Estimate list (server)
  estimates/[id]/page.tsx   Estimate detail (server)
  share/[id]/page.tsx       Public estimate view, no auth (server)
  profile/page.tsx          Business profile
  onboarding/page.tsx       First-run onboarding
  rates/page.tsx            Price book
  subscribe/page.tsx        Paywall
  components/               Shared UI components
  api/                      Route handlers
lib/
  supabase-server.ts        supabaseAdmin, createApiClient, createSupabaseServerClient
  supabase-browser.ts       createSupabaseBrowserClient
  stripe.ts                 Single Stripe instance (import from here only)
  format-phone.ts           Canadian phone formatting
  generate-pdf.ts           jsPDF estimate rendering
  hooks/
    use-business-profile.ts Shared profile data hook (logo, name, email, preparedBy)
proxy.ts                    Auth + subscription middleware (NOT middleware.ts)
```

---

## V1 Scope (Estimates — Starter Plan)

**Build only:**
- Create estimate (text input → AI generation → streaming)
- Review and edit estimate
- Send estimate (SMS, email, copy link)
- Basic customer and estimate storage
- Business profile (name, phone, email, logo)
- Stripe subscription + trial gating

**Do not build:**
- Reviews, Payments, Follow-Up (Pro features — separate routing under /reviews, /payments, /follow-up)
- Dashboards or analytics
- Team features or permissions
- Complex pricing engines, e-signatures, client portals

---

## Pro Features (Future — `/reviews`, `/payments`, `/follow-up`)

All Pro features live in this same app, gated by `plan` field on `tpe_businesses`.

- Reviews: post-job Google review requests via SMS/email
- Payments: automated invoice reminders until paid
- Follow-Up: scheduled customer outreach for maintenance/upgrades
- Camera input: photo → AI estimate enhancement (image sent to Anthropic as content block, requires Sonnet not Haiku)

Pro routes gated in `proxy.ts` by `business.plan === 'pro'`. Do not build Pro features into Starter routes.

---

## Primary Flow

```
Describe job → Generate estimate → Review / edit → Send
```

Each screen maps to one step. No step requires more than one decision.

---

## Routing

- `/` public landing page (light theme)
- `/new` estimate creation
- `/estimates` estimate list
- `/estimates/[id]` estimate detail
- `/share/[id]` public estimate (no auth)
- `/plumbers`, `/electricians` SEO landing pages
- `/plumbing-cost`, `/electrical-cost` SEO cost guides
- All app routes gated by `proxy.ts` (not `middleware.ts`), exported function must be named `proxy`

---

## Database Tables (Supabase, `tpe_` prefix)

- `tpe_businesses` — `user_id` (FK to auth.users), `name`, `phone`, `email`, `logo_url`, `prepared_by`, `plan` ('starter'|'pro'), `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `signup_source`
- `tpe_estimates` — `id`, `business_id` (FK to auth.users), `title`, `summary`, `status`, `customer_name`, `customer_phone`, `customer_email`, `customer_address`, `prepared_by`, `deposit_amount`, `sent_via`, `sent_at`, `created_at`
- `tpe_price_book` — `user_id` (FK to auth.users), `labour_rate`, `markup_percent`, `deposit_percent`, `deposit_threshold`
- `tpe_price_book_items` — `user_id` (FK to auth.users), `name`, `unit_price`

All tables: uuid primary keys, RLS enabled.

**Critical:**
- `tpe_businesses` uses `user_id` not `id` as the FK
- Business name field is `name` not `company_name`
- `tpe_estimates` uses `business_id` not `user_id` as the ownership FK
- Estimate content column is `summary` not `content`

`lib/database.types.ts` is generated from the live schema. Do not edit manually.
To regenerate: `npx supabase gen types typescript --project-id hmkkuyznyumhajjqbxpu > lib/database.types.ts`

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
// lib/stripe.ts — single source of truth
import { stripe } from "@/lib/stripe";
```

- CA$39/month Starter plan, CA$69/month Pro plan, 14-day free trial, no card required upfront
- `trial_ends_at` + `subscription_status` (default: `'trial'`) tracked in DB
- Webhooks sync subscription status — check `amount_paid > 0` in `invoice.payment_succeeded`
- Billing portal accessible from Profile page

---

## API Routes

- `POST /api/generate-estimate` — streams AI estimate, saves to `tpe_estimates`
  - `controller.close()` must come AFTER the `__ID__` chunk is enqueued
  - Input `jobDescription` capped at 2000 characters server-side
  - Rate limited: 10 calls per user per minute (in-memory Map)
- `PATCH /api/estimates` — update estimate fields
- `DELETE /api/estimates` — delete estimate (requires `?id=`)
- `POST /api/send-sms` — Twilio SMS (`{ to, estimateId }`)
- `POST /api/send-email` — Resend email; do not include `reply_to` / `replyTo` (TypeScript conflict)
- `GET /api/profile` — returns current user's `tpe_businesses` record
- `PATCH /api/profile` — upserts `tpe_businesses`
- `POST /api/upload-logo` — accepts base64 JSON `{ data, type }`, uploads to Supabase Storage under `{userId}/logo`, returns `{ url }`

## Public Routes (no auth required, listed in proxy.ts PUBLIC_PATHS)

- `/plumbers`, `/electricians` — trade-specific landing pages
- `/plumbing-cost`, `/electrical-cost` — cost guide pages
- `/share/[id]` — customer-facing estimate view

---

## Shared Components

- `EstimateMarkdown` — single source of truth for estimate markdown rendering. Never duplicate markdown component config. Import from `@/app/components/estimate-markdown`.
- `useBusinessProfile()` — hook for logo/name/email/preparedBy. Use in any screen that shows business identity. Never fetch `/api/profile` inside an event handler.

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
5. Assumptions and Exclusions (included / not included)
6. Pricing Summary (pipe table: subtotal, tax, total, deposit, balance)
7. Payment Terms (2 to 4 lines)
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
