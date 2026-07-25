# Handoff

Updated: 2026-07-25 PDT

## Current state

TradePulse Estimates' `main` branch carries the SPEC.md estimate-flow work (photo merge, photo persistence, structured line items), committed and pushed to `origin/main` along with the two previously unpushed commits (`240d0a8` AI_WORKFLOW.md, `12db30c` footer support email). SPEC.md is marked Done.

## Work completed

- **Analyze Photos merged into Generate Estimate.** The separate "Analyse Photos" button is gone. Generate Estimate now runs the vision call first when photos are attached, then feeds that analysis plus the typed description into `/api/generate-estimate` as a new optional `photoAnalysis` field (capped at 4000 chars server-side). The button reads "Reading photos..." while the vision call runs. Generate is enabled when there is a description or at least one photo; with photos only, the analysis becomes the description.
- **Vision analysis cached.** `app/new/page.tsx` keeps the last analysis keyed by a signature of photo ids plus notes. Regenerating without touching photos or notes reuses it instead of calling `/api/analyze-photo` again.
- **Photo / description / note persistence fixed (real bug).** Photos, per-photo notes, and photo errors previously lived inside `FormView`, which unmounts when the page switches to the estimate view, so going "Back to Description" came back to an empty form. That state now lives in `NewPageInner`. Only sending the estimate (`SendEstimateSheet onSent`) or starting a new one clears it.
- **Structured line items.** `lib/estimate-summary.ts` `LineItem` gained optional `quantity`, `unit`, `rate`. The Line Items markdown table is written as `| Item | Qty | Unit | Rate | Cost |` when any quantity-based item exists, and as the original `| Item | Cost |` otherwise. Quantity items show a read-only cost recalculated live as quantity x unit rate in `editable-estimate-body.tsx`; flat fees keep the single editable cost field. `computeTotals` now derives every subtotal from `lineItemCost()`, so a stale stored cost cell cannot drift from qty x rate. The generate-estimate system prompt tells the model to classify each item and pick a freeform unit.
- **No migration.** Old two-column estimates parse, render, and re-serialize exactly as before, verified in the browser side by side with the new format.
- Added `tests/smoke/photos-persist-after-generate.spec.ts`, a regression lock for the persistence bug. The AI endpoints and `/api/profile` are stubbed via `page.route` so the test is fast, free, and deterministic.

## Verification performed

- `npx next build` — compiled successfully, TypeScript clean.
- Playwright smoke suite against a local dev server (`PLAYWRIGHT_BASE_URL=http://localhost:3000`): 9 passed, 1 failed.
- The one failure, `payments-nav-no-direct-stripe.spec.ts`, is pre-existing and unrelated: it looks for a "Payments" link in the bottom nav, which was deliberately removed (Payments is reached via the pill on `/estimates`). Confirmed it fails identically on the pre-change baseline by stashing the changes and re-running.
- The new persistence test was confirmed to fail on the pre-change baseline and pass after, so it locks a real regression rather than passing vacuously.
- Browser check of the estimate view with both table formats: the new-format estimate showed Qty/Unit/Rate columns with a read-only cost, and a flat-fee row with cost only; the old-format estimate rendered unchanged. Editing quantity from 3 to 6 moved the line cost $285.00 to $570.00 and the total $457 to $756 live.
- Direct model call using the updated system prompt: the model produced the five-column table and correctly split quantity-based items (labour in hrs, paint in gal) from a flat-fee permit.

## Known problems

- `payments-nav-no-direct-stripe.spec.ts` is stale and fails on every run. It needs rewriting against the current Payments entry point (the pill on `/estimates`), or deleting. Not touched here, out of this spec's scope.
- `.claude/settings.local.json` and `.gitignore` still carry pre-existing, unrelated uncommitted changes, left for the user's own review.
- `.ai-control-centre/` and four `.bak-*` timestamped backup files remain untracked, still an open decision (gitignore vs. commit).
- Supabase custom domain for full Google OAuth consent-screen branding remains an open, optional decision.
- Carried over from the imported ChatGPT planning session, still undecided: the data model for business types/templates, the inspection-estimate schema and prompt changes, whether business type can change after onboarding, whether a third business type is warranted.

## Exact next action

Decide what to do with the stale `payments-nav-no-direct-stripe.spec.ts` (rewrite it against the `/estimates` Payments pill, or delete it). Then, separately, the carried-over Inspection Services planning question: propose the smallest implementation plan for adding that business type without changing existing Trades behaviour.

---
aiControlCentre:
  schemaVersion: 1
  status: Stable
  currentState: >-
    SPEC.md estimate-flow work is done and pushed to origin/main: Analyze Photos
    merged into Generate Estimate with cached vision analysis, photo/description
    /note state lifted so it survives the back-to-description flow, and
    quantity/unit/rate structured line items alongside the untouched legacy
    flat-fee format. Build clean, smoke suite 9 passed with 1 pre-existing
    unrelated failure.
  nextAction: >-
    Decide whether to rewrite or delete the stale
    payments-nav-no-direct-stripe.spec.ts, which looks for a bottom-nav Payments
    link that no longer exists. Separately, propose the smallest plan for an
    Inspection Services business type without changing Trades behaviour.
  updatedAt: '2026-07-25T00:00:00.000Z'
---
