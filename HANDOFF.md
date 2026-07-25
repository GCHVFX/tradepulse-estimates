# Handoff

Updated: 2026-07-25 PDT (second session same day: payments smoke test rewrite)

## Current state

TradePulse Estimates' `main` branch carries the SPEC.md estimate-flow work (photo merge, photo persistence, structured line items), committed and pushed to `origin/main` along with the two previously unpushed commits (`240d0a8` AI_WORKFLOW.md, `12db30c` footer support email). SPEC.md is marked Done.

## Work completed

- **Analyze Photos merged into Generate Estimate.** The separate "Analyse Photos" button is gone. Generate Estimate now runs the vision call first when photos are attached, then feeds that analysis plus the typed description into `/api/generate-estimate` as a new optional `photoAnalysis` field (capped at 4000 chars server-side). The button reads "Reading photos..." while the vision call runs. Generate is enabled when there is a description or at least one photo; with photos only, the analysis becomes the description.
- **Vision analysis cached.** `app/new/page.tsx` keeps the last analysis keyed by a signature of photo ids plus notes. Regenerating without touching photos or notes reuses it instead of calling `/api/analyze-photo` again.
- **Photo / description / note persistence fixed (real bug).** Photos, per-photo notes, and photo errors previously lived inside `FormView`, which unmounts when the page switches to the estimate view, so going "Back to Description" came back to an empty form. That state now lives in `NewPageInner`. Only sending the estimate (`SendEstimateSheet onSent`) or starting a new one clears it.
- **Structured line items.** `lib/estimate-summary.ts` `LineItem` gained optional `quantity`, `unit`, `rate`. The Line Items markdown table is written as `| Item | Qty | Unit | Rate | Cost |` when any quantity-based item exists, and as the original `| Item | Cost |` otherwise. Quantity items show a read-only cost recalculated live as quantity x unit rate in `editable-estimate-body.tsx`; flat fees keep the single editable cost field. `computeTotals` now derives every subtotal from `lineItemCost()`, so a stale stored cost cell cannot drift from qty x rate. The generate-estimate system prompt tells the model to classify each item and pick a freeform unit.
- **No migration.** Old two-column estimates parse, render, and re-serialize exactly as before, verified in the browser side by side with the new format.
- Added `tests/smoke/photos-persist-after-generate.spec.ts`, a regression lock for the persistence bug. The AI endpoints and `/api/profile` are stubbed via `page.route` so the test is fast, free, and deterministic.
- **Rewrote the stale payments smoke test** as `tests/smoke/payments-no-direct-stripe.spec.ts` (was `payments-nav-no-direct-stripe.spec.ts`). It was rewritten rather than deleted because the invariant it guards is still live: `/api/billing/upgrade` still exists and still returns a Stripe `redirectUrl`, so wiring a navigation-looking element back to it would reintroduce the bug fixed in `68e0c4b` (a non-Pro user tapping the Payments tab was thrown straight to Stripe Checkout with no confirmation). Only the old test's *implementation* was stale: it clicked a bottom-nav Payments link, so removing that tab in `d93768a` broke it even though the app was correct. The rewrite navigates to `/payments` directly, asserts the in-app Pro panel renders, asserts the upgrade path is a deliberate `<Link href="/subscribe">`, and waits to confirm nothing auto-navigates to a Stripe domain. A second test covers the current entry point, the "Unpaid Invoices" pill on `/estimates`. Neither test asserts anything about the bottom nav, so a future nav change cannot break them again.
- **Raised the suite's signup headroom.** `/api/auth/signup` allows 5 signups per hour per IP and the whole suite shares this machine's IP. The suite was already sitting exactly at that ceiling, and the two tests added today pushed it over, so an arbitrary later test started failing with a 429. `signUpFreshAccount` now resets the IP signup bucket before each provisioning signup. `signup-rate-limit.spec.ts` is unaffected: it calls the API directly rather than through the helper and does its own before/after resets. The two payments tests also share one account via `beforeAll`/`afterAll` rather than signing up twice.

## Verification performed

- `npx next build` — compiled successfully, TypeScript clean.
- **Playwright smoke suite against a local dev server (`PLAYWRIGHT_BASE_URL=http://localhost:3000`): 11 passed, 0 failed.** The previously reported `payments-nav-no-direct-stripe.spec.ts` failure is resolved by the rewrite described above, and the suite is fully green.
- Sanity-checked that the rewritten payments test actually catches the original bug: temporarily added a client component to the `/payments` non-Pro branch doing `window.location.href = "https://checkout.stripe.com/..."`, confirmed the test failed with `Received string: "https://checkout.stripe.com/c/pay/test-session"`, then reverted. Re-ran after the revert to confirm green.
- The persistence test was confirmed to fail on the pre-change baseline and pass after, so it locks a real regression rather than passing vacuously.
- Browser check of the estimate view with both table formats: the new-format estimate showed Qty/Unit/Rate columns with a read-only cost, and a flat-fee row with cost only; the old-format estimate rendered unchanged. Editing quantity from 3 to 6 moved the line cost $285.00 to $570.00 and the total $457 to $756 live.
- Direct model call using the updated system prompt: the model produced the five-column table and correctly split quantity-based items (labour in hrs, paint in gal) from a flat-fee permit.

## Known problems

- `.claude/settings.local.json` and `.gitignore` still carry pre-existing, unrelated uncommitted changes, left for the user's own review.
- `.ai-control-centre/` and four `.bak-*` timestamped backup files remain untracked, still an open decision (gitignore vs. commit).
- Supabase custom domain for full Google OAuth consent-screen branding remains an open, optional decision.
- Carried over from the imported ChatGPT planning session, still undecided: the data model for business types/templates, the inspection-estimate schema and prompt changes, whether business type can change after onboarding, whether a third business type is warranted.

## Exact next action

Nothing outstanding on the estimate flow or the smoke suite. The carried-over Inspection Services planning question is next: propose the smallest implementation plan for adding that business type without changing existing Trades behaviour.

---
aiControlCentre:
  schemaVersion: 1
  status: Stable
  currentState: >-
    SPEC.md estimate-flow work is done and pushed to origin/main: Analyze Photos
    merged into Generate Estimate with cached vision analysis, photo/description
    /note state lifted so it survives the back-to-description flow, and
    quantity/unit/rate structured line items alongside the untouched legacy
    flat-fee format. The stale payments smoke test was then rewritten to assert
    the no-direct-Stripe invariant instead of a removed nav element, and the
    suite's signup headroom raised. Build clean, smoke suite fully green at 11
    passed.
  nextAction: >-
    Propose the smallest implementation plan for an Inspection Services business
    type without changing existing Trades behaviour.
  updatedAt: '2026-07-25T18:20:00.000Z'
---
