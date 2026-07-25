# Handoff

Updated: 2026-07-25 PDT (fourth session same day: Payments empty-state and icon fix)

## Current state

TradePulse Estimates' `main` branch carries the SPEC.md estimate-flow work plus two same-day follow-ups (line item display fix, Payments empty-state/icon fix), committed and pushed to `origin/main`. SPEC.md is marked Done.

## Work completed

- **Analyze Photos merged into Generate Estimate.** The separate "Analyse Photos" button is gone. Generate Estimate now runs the vision call first when photos are attached, then feeds that analysis plus the typed description into `/api/generate-estimate` as a new optional `photoAnalysis` field (capped at 4000 chars server-side). Generate is enabled when there is a description or at least one photo; with photos only, the analysis becomes the description.
- **Vision analysis cached.** `app/new/page.tsx` keeps the last analysis keyed by a signature of photo ids plus notes. Regenerating without touching photos or notes reuses it instead of calling `/api/analyze-photo` again.
- **Photo / description / note persistence fixed (real bug).** That state now lives in `NewPageInner`, not `FormView`, so it survives the estimate-view switch. Only sending the estimate or starting a new one clears it.
- **Structured line items, then corrected the same day.** `lib/estimate-summary.ts` `LineItem` carries optional `quantity`, `unit`, `rate` in storage so the app can compute cost as quantity x rate. The first version of this also *displayed* those as separate Qty/Unit/Rate columns, which caused two real problems caught from a live screenshot: (1) the model's own stated cost for a quantity item could disagree with quantity x rate (one case showed $1,440.00 for "3 hours @ $45/hr", i.e. computed from 32 hours), and (2) the five-column table was unreadable on a phone, wrapping Item to one character per line and pushing Cost off screen. Fixed by keeping the two-column `Item | Cost` display everywhere (editor, the raw live-streaming preview before an estimate is saved, the share page, and the PDF, all now via `formatEstimateForDisplay` / `displayLineItemsBlock`), with quantity folded into the description text ("Labour (3 hours @ $45.00/hr)") and cost always computed in code, never trusted from the model. In the editor, a quantity item shows a small collapsed "3 hours @ $45.00" line under its description; tapping it opens qty/unit/rate fields, and the cost recalculates live. Flat-fee items are unchanged.
- **No migration.** Old two-column estimates parse, render, and re-serialize exactly as before.
- Added `tests/smoke/photos-persist-after-generate.spec.ts`, a regression lock for the persistence bug.
- **Rewrote the stale payments smoke test** as `tests/smoke/payments-no-direct-stripe.spec.ts` (was `payments-nav-no-direct-stripe.spec.ts`, pinned to a bottom-nav Payments link removed in `d93768a`). Rewritten rather than deleted because the invariant from `68e0c4b` (a non-Pro user must never be auto-redirected to Stripe) is still live: `/api/billing/upgrade` still exists and still returns a Stripe `redirectUrl`. The rewrite asserts the invariant directly against `/payments`, not against the nav.
- **Raised the suite's signup headroom.** `/api/auth/signup` allows 5 signups per hour per IP; the suite was at that ceiling. `signUpFreshAccount` now resets the bucket before each provisioning signup.
- **Payments empty state.** `/payments` for a Pro account with zero invoices used to just say "No outstanding invoices." with no way to tell where invoices come from, since there is no button on the page itself to create one. It now explains that a completed job becomes an invoice from its own estimate page, and links to `/estimates`.
- **Unpaid Invoices icon.** The hand-drawn `$` SVG next to "Unpaid Invoices" on `/estimates` rendered lopsided. Replaced with `lucide-react`'s `DollarSign`, matching the icon set already used elsewhere (Tag, FileText, User, Plus in the bottom nav).

## Verification performed

- `npx next build` — compiled successfully, TypeScript clean (checked after each of the four same-day changes).
- Playwright smoke suite against a local dev server (`PLAYWRIGHT_BASE_URL=http://localhost:3000`): 11 passed, 0 failed, most recently re-confirmed after the Payments empty-state/icon fix.
- Sanity-checked the rewritten payments test catches the original bug by temporarily reintroducing a `window.location.href` Stripe redirect, confirming failure, then reverting.
- The persistence test was confirmed to fail on the pre-change baseline and pass after.
- Line-item display fix verified with a temporary Playwright check at a real 412px mobile viewport, simulating a wrong AI-stated cost (32h-equivalent instead of 3h): confirmed the app displays the correct recomputed cost ($135.00) and total ($488), not the model's wrong values ($1,440.00 / $1,858), confirmed the two-column table fits on screen with no wrapping, confirmed tapping the collapsed quantity line opens qty/unit/rate fields and editing quantity live-updates cost and total, and confirmed an old-format estimate renders exactly as before. Screenshots reviewed directly, not just asserted.
- Payments empty-state and icon fix verified with a temporary Playwright check: a throwaway account flipped to Pro directly in the DB (the pages read `plan` server-side, not through a client fetch), navigated to `/estimates` and `/payments` with zero invoices, screenshots reviewed directly at a 412px mobile viewport.

## Known problems

- `.claude/settings.local.json` and `.gitignore` still carry pre-existing, unrelated uncommitted changes, left for the user's own review.
- `.ai-control-centre/` and four `.bak-*` timestamped backup files remain untracked, still an open decision (gitignore vs. commit).
- Supabase custom domain for full Google OAuth consent-screen branding remains an open, optional decision.
- Carried over from the imported ChatGPT planning session, still undecided: the data model for business types/templates, the inspection-estimate schema and prompt changes, whether business type can change after onboarding, whether a third business type is warranted.
- Not independently re-verified today: the share page and PDF render of a quantity-based line item against a real saved estimate (both go through the same `formatEstimateForDisplay` path already verified for the editor and live-streaming preview, but a live DB-backed render of `/share/[id]` and a generated PDF file were not opened this session).

## Exact next action

Nothing outstanding on the estimate flow or the smoke suite. If it matters before this ships further, spot-check `/share/[id]` and a downloaded PDF for a quantity-based estimate. Otherwise the carried-over Inspection Services planning question is next: propose the smallest implementation plan for adding that business type without changing existing Trades behaviour.

---
aiControlCentre:
  schemaVersion: 1
  status: Stable
  currentState: >-
    SPEC.md estimate-flow work is done and pushed to origin/main, plus two
    same-day follow-ups. First: two real bugs in the structured line items
    (AI-stated cost disagreeing with quantity x rate, five-column table
    unreadable on a phone), fixed by computing cost in code and collapsing
    every display surface to a two-column table. Second: /payments' empty
    state gave a Pro user with zero invoices no way to know where invoices
    come from, now explains and links to /estimates; the lopsided hand-drawn
    $ icon next to Unpaid Invoices swapped for lucide-react's DollarSign.
    Build clean, smoke suite fully green at 11 passed.
  nextAction: >-
    Optionally spot-check the share page and a downloaded PDF for a
    quantity-based estimate (not yet independently re-verified this session).
    Otherwise, propose the smallest implementation plan for an Inspection
    Services business type without changing existing Trades behaviour.
  updatedAt: '2026-07-25T19:45:00.000Z'
---
