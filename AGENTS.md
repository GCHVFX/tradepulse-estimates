<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# TradePulse Agent Instructions

Before making implementation changes, read:

- `CODEX.md`
- `docs/SCALING-NOTES.md`

Follow the product, architecture, billing, auth, UI, writing, and scalability rules in those files.

## Core Rules

- Keep TradePulse simple. The main workflow is: Describe job -> Generate estimate -> Review / edit -> Send.
- Mobile-first always. Large tap targets, one obvious primary action, no dashboard as the entry point.
- Server components by default. Client components only when interactivity requires it.
- Do not use `any`. Use `unknown` and narrow.
- Do not touch unrelated code. Surface unrelated issues separately.

## Next.js Rules

- This app uses Next.js App Router with newer breaking changes.
- Read the relevant file in `node_modules/next/dist/docs/` before changing routing, pages, layouts, route handlers, cache behavior, server/client boundaries, or proxy behavior.
- Auth gating lives in `proxy.ts`. Do not create `middleware.ts`. The exported function must be named `proxy`.

## Supabase Rules

- Use the local helpers in `@/lib/supabase-server` and `@/lib/supabase-browser`.
- Never import from `@supabase/auth-helpers-nextjs`. Use `@supabase/ssr`.
- Server-side auth must use `getUser()`, not `getSession()`.
- Use `.maybeSingle()`, not `.single()`.
- `lib/database.types.ts` is generated from the live schema. Do not edit it manually.

## Billing Rules

- Keep `plan` separate from `subscription_status`.
- Feature access uses `business.plan === "pro"`.
- App access uses active trial, active subscription, or complimentary status.
- Trial or expired-trial users on `/subscribe` should see Starter and Pro.
- Active Starter users upgrading should see only Pro.
- Active Pro users should not see an upgrade option.
- Paid Starter and Pro users should have a Stripe Portal path to manage or cancel their subscription.
- Refunds are manual. TradePulse offers a 30-day money-back guarantee on the first paid charge, handled by support and Stripe admin. Do not add a customer-facing refund button unless explicitly requested.
- Required Stripe webhook events are `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_succeeded`.
- Stripe sends `canceled`; app status is `cancelled`. Normalize at the webhook boundary.
- Pro checkout depends on `STRIPE_PRO_PRICE_ID`; handle a missing value with clear UI instead of a broken upgrade path.
- Customer Portal cancellation is configured in Stripe Dashboard, not code. Confirm it is enabled before launch.
