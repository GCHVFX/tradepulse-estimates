# TradePulse Estimates, Claude Code Context

TradePulse Estimates turns a short job description into a professional estimate in seconds. Mobile-first. Built for contractors in the field.

---

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Supabase (database + auth)
- Twilio (SMS), Resend (email)
- Anthropic API, `claude-haiku-4-5-20251001` for estimate generation
- Stripe (subscriptions, CA$39/month Starter, 14-day free trial)
- Vercel (hosting)

---

## Development Rules

- Server components by default, client components only when interactivity requires it
- Always output complete files, not partial snippets
- Mobile-first always
- Keep components small. Do not over-componentize early.
- Prefer simple solutions over complex patterns

---

## V1 Scope

**Build only:**
- Create estimate (text input → AI generation → streaming)
- Review and edit estimate
- Send estimate (SMS, email, copy link)
- Basic customer and estimate storage
- Business profile (name, phone, email, logo)
- Stripe subscription + trial gating

**Do not build:**
- Review requests, payment reminders, follow-up / CRM
- Dashboards or analytics
- Team features or permissions
- Complex pricing engines, e-signatures, client portals

---

## Primary Flow

```
Describe job → Generate estimate → Review / edit → Send
```

Each screen maps to one step. No step requires more than one decision.

---

## Routing

- `/`, public landing page (light theme)
- `/new`, estimate creation
- All app routes gated by `proxy.ts` (not `middleware.ts`), exported function must be named `proxy`

---

## Database Tables (Supabase, `tpe_` prefix)

- `tpe_businesses`, `user_id` (FK to auth.users), `name`, `phone`, `email`, `logo_url`, `prepared_by`, `updated_at`
- `tpe_customers`, homeowner details
- `tpe_estimates`, `id`, `business_id` (FK to auth.users), `title`, `summary`, `status`, `customer_name`, `customer_phone`, `customer_email`, `customer_address`, `prepared_by`, `created_at`
- `tpe_price_book`, `user_id` (FK to auth.users), `labour_rate`, `markup_percent`, `deposit_percent`, `deposit_threshold`
- `tpe_price_book_items`, `user_id` (FK to auth.users), `name`, `unit_price`

All tables: uuid primary keys, RLS enabled.

**Critical:** `tpe_businesses` uses `user_id` not `id` as the FK. Business name field is `name` not `company_name`. `tpe_estimates` uses `business_id` not `user_id` as the ownership FK. Estimate content column is `summary` not `content`.

---

## Supabase Clients

- `supabaseAdmin`, service role, bypasses RLS, server only (`@/lib/supabase-server`)
- `createSupabaseServerClient()`, SSR anon client for server components (`@/lib/supabase-server`)
- `createSupabaseBrowserClient()`, browser client for client components (`@/lib/supabase-browser`)

Never import from `@supabase/auth-helpers-nextjs`. Always use `@supabase/ssr`.
Never use `.single()`. Use `.maybeSingle()`.
Never use `supabase.auth.getSession()` server-side. Always use `getUser()`.

---

## Auth Pattern

```typescript
// API routes (request-scoped)
const supabase = createServerClient(url, key, {
  cookies: {
    getAll() { return request.cookies.getAll(); },
    setAll() {},
  },
});

// Server components
const supabase = await createSupabaseServerClient();
```

---

## API Routes

- `POST /api/generate-estimate`, streams AI-generated estimate, saves to `tpe_estimates`; `controller.close()` must come AFTER the `__ID__` chunk is enqueued
- `POST /api/send-sms`, Twilio SMS (`{ to, estimateId }`)
- `POST /api/send-email`, Resend email; do not include `reply_to` / `replyTo` (TypeScript conflict)
- `GET /api/profile`, returns current user's `tpe_businesses` record
- `PATCH /api/profile`, upserts `tpe_businesses`
- `POST /api/upload-logo`, accepts base64 JSON `{ data, type }`, uploads logo to Supabase Storage under `{userId}/logo`, returns `{ url }`
- `POST /api/upload-logo`, accepts base64 JSON `{ data, type }`, uploads logo to Supabase Storage under `{userId}/logo`, returns `{ url }`

## Public Routes

Public routes (no auth required, listed in proxy.ts PUBLIC_PATHS):
- `/plumbers`, `/electricians` — trade-specific landing pages
- `/plumbing-cost`, `/electrical-cost` — cost guide pages
- `/share/[id]` — customer-facing estimate view

---

## Twilio SMS

Env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
Phone formatting: Canadian numbers. Strip non-digits, add +1 prefix if not present.
SMS pulls `name` from `tpe_businesses` (not `company_name`).

---

## Stripe

- Single Stripe account shared with TradePulse Reviews
- CA$39/month Starter plan, 14-day free trial, no card required upfront
- `trial_ends_at` + `subscription_status` (default: `'trial'`) tracked in DB
- Webhooks sync subscription status
- Billing portal accessible from Profile page
- Keep Stripe API version current, do not pin to old versions

---

## Estimate Output Structure

Every generated estimate follows this exact structure:

1. Job Title
2. Job Summary (2 to 3 sentences)
3. Scope of Work (bullet list, specific tasks, plain language)
4. Line Items (labour and materials, pipe table)
5. Assumptions and Exclusions (included / not included)
6. Pricing Summary (pipe table: subtotal, tax, total, deposit, balance)
7. Payment Terms (2 to 4 lines)
8. Notes (optional, omit if nothing relevant)

Customer details are stored as columns on `tpe_estimates` and rendered via `CustomerDetailsBlock`. Not baked into AI output. AI system prompt must explicitly say not to output customer details in the estimate body. H1 lines are filtered from markdown rendering. Business name and job title are displayed separately in the UI.

---

## UI Rules

- Large tap targets (minimum 44px)
- One primary action per screen, always visible
- No blank states, always show a default or example
- Progressive disclosure, advanced options hidden until needed
- Primary buttons fixed to bottom on mobile
- No dashboards as entry points
- Max 2 levels of navigation depth
- Bottom nav points to `/new`

---

## Writing Rules (applies to all UI copy and generated text)

- Write like a contractor, not like software
- Short sentences, plain language, Canadian English (labour, colour)
- No em dashes, use a period or comma instead
- No filler transitions: Additionally, Furthermore, Moreover
- No padding: It is important to note, In order to
- No forbidden words: ensure, streamline, leverage, utilize, seamless, comprehensive, facilitate
- Prices specific and labelled, never vague
- Scope descriptions specific, never vague
- UI labels: action verbs, short. Create Estimate, Send Estimate, Edit Items

---

## Claude Chat Conventions

**CC** means Claude Code. When the user says "give this to CC" or "CC prompt",
they mean a prompt to paste into the Claude Code extension in VS Code.

**Claude Code prompt format:**
When providing instructions to run in Claude Code, always format them as a
plain fenced code block with no extra UI, no buttons, no widgets. Like this:

Open `path/to/file.tsx` and give this to CC:

` ` `
In path/to/file.tsx, do X.

1. Find Y and replace with Z.
2. Add this import at the top: ...
` ` `

Never use interactive widgets or custom HTML boxes for CC prompts.
Plain fenced code blocks only — they are easy to copy on any device.
