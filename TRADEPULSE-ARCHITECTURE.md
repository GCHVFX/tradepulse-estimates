# TradePulse — Architecture & Refactoring Design Document

*Generated from codebase analysis of TPE.zip. Next.js 16 / React 19 / Supabase / Stripe / Vercel.*

---

## 1. Current Architecture Overview

### File Structure (Annotated)

```
/
├── proxy.ts                        Auth + subscription gating middleware
├── next.config.ts                  Sentry + image domain config
├── CLAUDE.md                       Claude Code context (well maintained)
│
├── app/
│   ├── layout.tsx                  Root layout, PostHog provider
│   ├── page.tsx                    Landing page (light theme)
│   ├── globals.css                 Global styles
│   │
│   ├── new/page.tsx                Estimate creation + streaming (612 lines — too large)
│   ├── estimates/page.tsx          Estimate list (126 lines — fine)
│   ├── estimates/[id]/page.tsx     Estimate detail, server component (116 lines — fine)
│   ├── share/[id]/page.tsx         Public estimate view, no auth (249 lines)
│   ├── profile/page.tsx            Business profile
│   ├── onboarding/page.tsx         First-run onboarding
│   ├── rates/page.tsx              Price book
│   ├── subscribe/page.tsx          Paywall / trial expired
│   ├── login/page.tsx              Auth
│   ├── signup/page.tsx             Auth
│   ├── reset-password/page.tsx     Auth
│   │
│   ├── plumbers/page.tsx           SEO landing page
│   ├── electricians/page.tsx       SEO landing page
│   ├── plumbing-cost/page.tsx      SEO cost guide
│   ├── electrical-cost/page.tsx    SEO cost guide
│   │
│   ├── components/
│   │   ├── editable-estimate-body.tsx   Estimate editor with inline editing (600 lines — too large)
│   │   ├── send-estimate-sheet.tsx      Bottom sheet: SMS / email / link / PDF (414 lines)
│   │   ├── onboarding-form.tsx          Business setup form (583 lines)
│   │   ├── profile-form.tsx             Profile edit form (385 lines)
│   │   ├── price-book.tsx               Labour rate + items editor (344 lines)
│   │   ├── customer-details-block.tsx   Editable customer info on estimate (173 lines)
│   │   ├── estimate-actions.tsx         Fixed bottom action bar for estimate detail
│   │   ├── EstimateDemo.tsx             Demo widget for landing pages (466 lines)
│   │   ├── bottom-nav.tsx               App navigation
│   │   ├── company-estimate-header.tsx  Logo + business name header
│   │   ├── logo.tsx                     TradePulse wordmark
│   │   ├── trial-banner.tsx             Trial status banner
│   │   ├── deposit-block.tsx            Deposit input on estimates
│   │   ├── local-date-text.tsx          Client-side date formatting
│   │   ├── delete-estimate-button.tsx   Delete with confirm
│   │   ├── delete-estimate-link.tsx     Delete link variant
│   │   ├── download-pdf-button.tsx      PDF generation trigger
│   │   └── posthog-*.tsx               Analytics provider components
│   │
│   └── api/
│       ├── generate-estimate/route.ts   Anthropic streaming, saves to DB
│       ├── estimates/route.ts           PATCH (update) + DELETE estimate
│       ├── profile/route.ts             GET + PATCH business profile
│       ├── price-book/route.ts          GET + PATCH price book settings
│       ├── price-book-items/route.ts    GET + POST + DELETE price book items
│       ├── send-sms/route.ts            Twilio SMS send
│       ├── send-email/route.ts          Resend email send
│       ├── upload-logo/route.ts         Base64 → Supabase Storage
│       ├── auth/signup/route.ts         Signup + Stripe trial creation
│       ├── billing/checkout/route.ts    Stripe Checkout session
│       ├── billing/portal/route.ts      Stripe billing portal
│       ├── billing/webhook/route.ts     Stripe webhook handler
│       └── webhooks/new-signup/route.ts Supabase auth hook → Resend notification
│
└── lib/
    ├── supabase-server.ts    supabaseAdmin, createApiClient, createSupabaseServerClient
    ├── supabase-browser.ts   createSupabaseBrowserClient
    ├── format-phone.ts       Canadian phone formatting
    └── generate-pdf.ts       jsPDF estimate rendering
```

### Data Model

```
tpe_businesses
  user_id (FK → auth.users, PK)
  name
  phone
  email
  logo_url
  prepared_by
  stripe_customer_id
  stripe_subscription_id
  subscription_status   ('trial' | 'active' | 'canceled' | 'complimentary')
  trial_ends_at
  updated_at

tpe_estimates
  id (uuid)
  business_id (FK → auth.users)
  title
  summary               (full markdown content)
  status                ('draft' | 'sent')
  customer_name
  customer_phone
  customer_email
  customer_address
  prepared_by
  deposit_amount
  created_at

tpe_price_book
  user_id (FK → auth.users)
  labour_rate
  markup_percent
  deposit_percent
  deposit_threshold

tpe_price_book_items
  id
  user_id (FK → auth.users)
  name
  unit_price
  created_at
```

### Auth & Access Control

- `proxy.ts` runs on every non-static request
- Checks: authenticated → has `tpe_businesses` row → subscription active or trialing
- Missing business row → `/subscribe`
- Expired/canceled → `/subscribe`
- All API routes independently verify `getUser()` — no trust in middleware for data access
- `supabaseAdmin` used for all data writes (bypasses RLS) — appropriate for server-only routes

### Subscription Gating

```
subscription_status values:
  'trial'          → check trial_ends_at > now()
  'active'         → full access
  'complimentary'  → full access (manual override)
  'canceled'       → redirect to /subscribe
  anything else    → redirect to /subscribe
```

Webhook events handled: `subscription.created`, `subscription.updated`, `subscription.deleted`, `invoice.payment_succeeded` (with `amount_paid > 0` guard).

---

## 2. What's Working Well (Do Not Refactor)

| Area | Status | Notes |
|------|--------|-------|
| Auth patterns | Solid | `getUser()` everywhere, no `getSession()` server-side |
| Supabase client separation | Solid | Admin vs anon vs browser correctly separated |
| Streaming implementation | Solid | `controller.close()` ordering correct, `__ID__` chunk handled |
| Webhook billing logic | Solid | `amount_paid > 0` guard, sub ID guard on deletion |
| Middleware gating | Solid | Public paths list, subscription status checks correct |
| CLAUDE.md | Good | Gotchas documented, conventions clear |
| API route auth | Solid | Every route independently verifies user |
| Error handling shape | Acceptable | `catch {}` blocks present throughout |

---

## 3. Refactoring Opportunities (Prioritised by ROI)

### Priority 1 — Do These Before Adding Any Pro Features

#### 3.1 Extract Shared Markdown Renderer

**Problem:** Full `ReactMarkdown` component config (12 element overrides, ~60 lines) is duplicated verbatim between `new/page.tsx` and `editable-estimate-body.tsx`. A third copy is about to appear in the share page and eventually in Reviews and Payments if estimate previews are needed there.

**Impact:** Style drift between estimate preview and estimate edit view is inevitable. Already two copies, will be four.

**Fix:** Create `app/components/estimate-markdown.tsx`

```tsx
// app/components/estimate-markdown.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components = {
  // ... the single source of truth for all markdown styles
};

export function EstimateMarkdown({ content }: { content: string }) {
  const filtered = content
    .split("\n")
    .filter((l) => !l.startsWith("# "))
    .join("\n");

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {filtered}
    </ReactMarkdown>
  );
}
```

Replace both usages. Delete ~120 lines total from the codebase.

---

#### 3.2 Create `lib/stripe.ts`

**Problem:** `new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-03-25.dahlia" })` is instantiated in 4 separate API routes. The API version string is hardcoded 4 times.

**Impact:** Next Stripe API version bump requires finding and changing 4 files. Miss one and you have a runtime type mismatch.

**Fix:**

```ts
// lib/stripe.ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});
```

Import `{ stripe }` in `checkout/route.ts`, `webhook/route.ts`, `portal/route.ts`, `auth/signup/route.ts`. Done.

---

#### 3.3 Add Rate Limiting and Input Length Cap on `/api/generate-estimate`

**Problem:** No protection against repeated calls. No server-side length validation on `jobDescription`. A runaway client loop or a bad actor can generate unlimited Anthropic API calls billed to your account.

**Impact:** Direct cost risk. Not theoretical — this is how vibe-coded SaaS products get surprise $400 API bills.

**Fix (minimal, no external dep):**

```ts
// In generate-estimate/route.ts, after user auth check:

// 1. Input length cap
if (jobDescription.length > 2000) {
  return new Response("Job description too long", { status: 400 });
}

// 2. Simple in-memory rate limit (per user, per process)
// For a single Vercel function instance this is sufficient at current scale
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const now = Date.now();
const limit = rateLimitMap.get(user.id);
if (limit && now < limit.resetAt) {
  if (limit.count >= 10) {
    return new Response("Too many requests", { status: 429 });
  }
  limit.count++;
} else {
  rateLimitMap.set(user.id, { count: 1, resetAt: now + 60_000 });
}
```

Note: In-memory rate limiting does not work across Vercel function instances if traffic is high enough to spawn multiple. At current scale it's fine. When you're at 200+ active users, switch to Vercel KV.

---

#### 3.4 Remove Production `console.log` Calls

**Problem:** 3 `console.log` calls active in production API routes, logging Supabase response data and Stripe billing events including customer IDs and payment amounts.

**Locations:**
- `app/api/generate-estimate/route.ts:193` — logs Supabase insert response
- `app/api/billing/webhook/route.ts:73` — logs `customerId` + `amountPaid`
- `app/api/billing/webhook/route.ts:81` — logs Supabase update result

**Fix:** Delete all three. Sentry captures actual errors. If you want webhook observability, log only on error:

```ts
if (error) console.error("[webhook] tpe_businesses update failed", { error });
```

---

#### 3.5 Fix CLAUDE.md Duplicate Entry

**Problem:** `POST /api/upload-logo` is listed twice under API Routes.

**Fix:** Delete one. 10 seconds.

---

### Priority 2 — Before Payments Feature Build

#### 3.6 Extract Profile Data Hook from `new/page.tsx`

**Problem:** Profile data (`logoUrl`, `businessName`, `preparedBy`, `businessEmail`) is fetched inside `handleGenerate()` — meaning it fires on every estimate generation, not on page load. This causes a visible flash where the estimate renders without the company header, then the header appears after the profile fetch resolves.

**Secondary problem:** This fetch will need to be replicated in every new Pro feature screen that shows business identity.

**Fix:** Move profile fetch to a `useEffect` on mount. Extract a `useBusinessProfile()` hook:

```ts
// lib/hooks/use-business-profile.ts
"use client";

import { useState, useEffect } from "react";

interface BusinessProfile {
  logoUrl: string | null;
  businessName: string;
  businessEmail: string;
  preparedBy: string;
}

export function useBusinessProfile() {
  const [profile, setProfile] = useState<BusinessProfile>({
    logoUrl: null,
    businessName: "",
    businessEmail: "",
    preparedBy: "",
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d?.profile) {
          setProfile({
            logoUrl: d.profile.logo_url ?? null,
            businessName: d.profile.name ?? "",
            businessEmail: d.profile.email ?? "",
            preparedBy: d.profile.prepared_by ?? "",
          });
        }
      })
      .catch(() => {});
  }, []);

  return profile;
}
```

This hook will be used by `new/page.tsx`, the Reviews screen, Payments screen, and Follow-Up screen. Write it once.

---

#### 3.7 Decompose `new/page.tsx`

**Problem:** 612 lines. Handles: profile data, streaming, error states, customer details, job title extraction, first-time detection, URL prefill, sign out, placeholder cycling, send sheet coordination. Every change to this file requires loading all of it into context.

**Fix:** Split into focused units without over-engineering:

```
app/new/
  page.tsx                 ~150 lines — orchestration only
  _components/
    job-form.tsx           ~120 lines — textarea, customer fields, prefill logic
    estimate-preview.tsx   ~100 lines — white card, header, EstimateMarkdown
    generating-state.tsx   ~30 lines  — spinner + status text
```

The streaming logic and state machine (`view`, `generating`, `estimate`, `saved`, `savedEstimateId`) stays in `page.tsx` as the orchestrator. The form and preview are dumb components that receive props.

This is not urgent today. Do it when you're about to add camera input to this page — that's the natural moment to decompose because you'll be adding significant new logic.

---

### Priority 3 — Nice to Have, Low Urgency

#### 3.8 Add `GET /api/estimates` for Estimate List

**Problem:** The estimate list page (`/estimates/page.tsx`) fetches data but there is no `GET` handler in `app/api/estimates/route.ts`. The `GET` is referenced in `new/page.tsx` (`fetch("/api/estimates")`) to detect first-time users, but the route file only exports `PATCH` and `DELETE`. This suggests the estimates list is fetched via a server component directly, which is correct — but the `GET` call in the client is hitting a 405.

**Check:** Verify whether `/api/estimates` GET returns 405 in production. If the first-time detection is silently failing, the onboarding prompt never shows.

---

#### 3.9 Type the Supabase Query Results

**Problem:** Several places use `.select("*")` and then access fields with no type safety. `estimate.business_id`, `estimate.customer_name`, etc. are all `unknown` at the type level until narrowed.

**Fix:** Generate Supabase types:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts
```

Then import and use in `createClient<Database>()`. This is a one-time setup that gives you autocomplete and catches field name typos at compile time. Worth doing before the Pro feature build adds more tables.

---

## 4. Pro Feature Architecture Plan

### Decision: One App, Feature-Gated

All four Pro features live in the same Next.js app. No separate deployments. Gate by `subscription_status` and eventually a `plan` field on `tpe_businesses`.

### Recommended Route Structure

```
/estimates        Starter + Pro
/reviews          Pro only
/payments         Pro only
/follow-up        Pro only
```

Gate in `proxy.ts`:

```ts
const PRO_PATHS = ["/reviews", "/payments", "/follow-up"];
const isPro = PRO_PATHS.some((p) => pathname.startsWith(p));
const plan = business.plan; // 'starter' | 'pro'

if (isPro && plan !== "pro" && pathname !== "/subscribe") {
  return NextResponse.redirect(new URL("/subscribe?upgrade=pro", request.url));
}
```

Add `plan` column to `tpe_businesses`:

```sql
alter table tpe_businesses
  add column plan text not null default 'starter'
  check (plan in ('starter', 'pro'));
```

Update `auth/signup/route.ts` to set `plan` based on which Stripe price ID was used.

### Database Tables Per Feature

Each feature owns its tables. All share `tpe_businesses` for identity.

```sql
-- Reviews
create table tpe_review_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references auth.users not null,
  estimate_id uuid references tpe_estimates(id),
  customer_name text,
  customer_phone text,
  customer_email text,
  google_review_url text,
  trigger text,       -- 'job_complete' | 'invoice_sent' | 'invoice_paid'
  status text,        -- 'pending' | 'sent' | 'reviewed'
  sent_at timestamptz,
  created_at timestamptz default now()
);

-- Payments
create table tpe_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references auth.users not null,
  estimate_id uuid references tpe_estimates(id),
  customer_name text,
  customer_phone text,
  customer_email text,
  amount numeric(10,2),
  due_date date,
  status text,        -- 'unpaid' | 'paid' | 'overdue' | 'written_off'
  payment_link text,
  last_reminder_at timestamptz,
  reminder_count int default 0,
  created_at timestamptz default now()
);

-- Follow-Up
create table tpe_follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references auth.users not null,
  estimate_id uuid references tpe_estimates(id),
  customer_name text,
  customer_phone text,
  customer_email text,
  follow_up_type text,  -- 'maintenance' | 'seasonal' | 'upgrade' | 'custom'
  scheduled_for date,
  status text,          -- 'scheduled' | 'sent' | 'skipped'
  message text,
  created_at timestamptz default now()
);
```

### Reminder/Automation Architecture

Reviews, Payments, and Follow-Up all need time-delayed outreach. Do not use cron jobs inside Next.js. Use **Supabase pg_cron** or **Vercel Cron Jobs** calling a protected internal API route.

Pattern:

```
Vercel Cron → POST /api/internal/process-reminders
  → Auth via INTERNAL_CRON_SECRET header
  → Query for pending sends
  → Send via Twilio/Resend
  → Update status
```

```ts
// app/api/internal/process-reminders/route.ts
export async function POST(request: NextRequest) {
  if (request.headers.get("x-cron-secret") !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // query and process
}
```

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/internal/process-reminders",
      "schedule": "0 9 * * *"
    }
  ]
}
```

### Camera Feature

Not a separate route. Lives inside `/new` as an optional input alongside the text field.

```
/new/page.tsx
  └── job-form.tsx
        ├── JobDescriptionTextarea
        ├── CameraInput (Pro only, hidden for Starter)
        └── CustomerFields
```

Camera input flow:
1. User taps camera icon
2. `<input type="file" accept="image/*" capture="environment">` — native camera on mobile
3. Client converts to base64
4. Sends to `/api/generate-estimate` alongside `jobDescription`
5. Route adds image as a `content` block in the Anthropic message

```ts
// In generate-estimate/route.ts, extend the message:
messages: [{
  role: "user",
  content: imageBase64
    ? [
        { type: "image", source: { type: "base64", media_type: imageType, data: imageBase64 } },
        { type: "text", text: userMessage },
      ]
    : userMessage,
}]
```

Model must switch from Haiku to Sonnet for image analysis (Haiku does not support vision). Gate the image input to Pro plan only — this is your highest-cost feature.

---

## 5. Bottom Nav for Pro Features

Current bottom nav has static links. When Pro features are live, it needs to be plan-aware.

```tsx
// components/bottom-nav.tsx
const navItems = [
  { href: "/new",       label: "New",       icon: PlusIcon },
  { href: "/estimates", label: "Estimates", icon: ListIcon },
  { href: "/reviews",   label: "Reviews",   icon: StarIcon,    pro: true },
  { href: "/payments",  label: "Payments",  icon: DollarIcon,  pro: true },
  { href: "/follow-up", label: "Follow-Up", icon: BellIcon,    pro: true },
];
```

Pro-locked items show with a lock badge and redirect to `/subscribe?upgrade=pro` on tap for Starter users. Do not hide them — showing locked features is part of the upgrade path.

---

## 6. Immediate Action List

In priority order. No prompts yet — this is the plan.

| # | Action | File(s) | Effort |
|---|--------|---------|--------|
| 1 | Delete 3 `console.log` calls | `generate-estimate/route.ts`, `webhook/route.ts` | 5 min |
| 2 | Fix CLAUDE.md duplicate entry | `CLAUDE.md` | 2 min |
| 3 | Create `lib/stripe.ts` singleton | New file + 4 route files | 20 min |
| 4 | Extract `EstimateMarkdown` component | `new/page.tsx`, `editable-estimate-body.tsx`, new file | 30 min |
| 5 | Add length cap + rate limit to generate-estimate | `generate-estimate/route.ts` | 20 min |
| 6 | Verify `/api/estimates` GET behaviour | `api/estimates/route.ts`, `new/page.tsx` | 15 min |
| 7 | Create `lib/hooks/use-business-profile.ts` | New file | 20 min |
| 8 | Add `plan` column to `tpe_businesses` | Supabase migration | 10 min |
| 9 | Generate Supabase types | `lib/database.types.ts` | 15 min |
| 10 | Decompose `new/page.tsx` | Before camera feature build | 2–3 hrs |
