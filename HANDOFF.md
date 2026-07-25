# Handoff

Updated: 2026-07-25 PDT (fifth session same day: line item edit bug, labour hours, footer, New button overlap)

## Current state

TradePulse Estimates' `main` branch carries the SPEC.md estimate-flow work plus five same-day follow-ups, all committed and pushed to `origin/main`. SPEC.md is marked Done.

## Work completed

- **Analyze Photos merged into Generate Estimate**, **vision analysis cached**, **photo/description/note persistence fixed**, **structured line items with quantity x rate computed in code**, **no migration** — see prior entries in git log; unchanged this session except where noted below.
- **Line item quantity/rate editing bug, fixed twice in the same session.** Clearing a quantity field to retype it (select-and-delete, the natural flow) used to permanently reclassify the item as a flat fee mid-edit, because `isQuantityItem()` in `lib/estimate-summary.ts` required both quantity AND rate non-blank, and the editor's expand/collapse panel is gated on that same check — the panel unmounted itself the instant the field emptied, with no way back in. A first fix (AND to OR) solved that but introduced a new bug: the AI sometimes fills Qty and Unit for a material but leaves Rate blank rather than leaving all three blank as instructed, and an OR check treats that as a quantity item with a zero rate, discarding the AI's own stated cost. Both are now fixed by a `quantityBased` flag set once, strictly, at parse time, never re-derived from live field values. Locked in with `tests/smoke/line-item-qty-clear-does-not-lock.spec.ts` (two cases).
- **Labour hour estimates tuned.** Added explicit guidance to the `generate-estimate` system prompt: estimate hours the way an experienced tradesperson actually works, not with a built-in safety margin, with concrete anchors (a small contained job is 1 to 3 hours, not a full day). Verified with a real model call on a job similar to the one that prompted this (cap two pipes, patch drywall, repair baseboard): dropped from a reported double-digit hour count to 4.5 hours.
- **Share page footer shrunk.** "Create your own estimate at TradePulse" (bordered section, own logo, own padding block) is now a single small "Powered by TradePulse" line, since the customer reviewing the estimate has no use for it and the original read more like a pitch than a footer credit.
- **New button overlap fixed.** The earlier `bottom-[102px]` → `bottom-[90px]` gap fix (see prior session) pulled the estimate detail action bar close enough that BottomNav's floating New circle (z-40, rendered on top) started overlapping the bottom ~6.5px of the Send Estimate button (z-30) — a tap meant for that button could land on New instead. Fixed with more bottom padding on the action bar (`pb-4` → `pb-7`) so the button clears the circle without moving the bar's own outer edge (which still needs to touch the nav, or the original gap bug reopens). Locked in with `tests/smoke/new-circle-no-button-overlap.spec.ts`.
- **Scroll jank investigated, not conclusively fixed.** User reported the estimate detail page shifts up/down constantly while scrolling to read. Leading hypothesis (a nested `overflow-auto` main creating a double-scroll-container ambiguity with the outer document) was directly measured and ruled out: `main`'s `overflow-auto` is a no-op given the wrapper's `min-h-dvh` (a floor, not a cap) — the page has exactly one scroll container, normal document-level scroll, confirmed via live `getBoundingClientRect`/`scrollY` measurement. Removed the now-clearly-dead `overflow-auto` class for clarity (harmless, doesn't change behaviour). The remaining likely explanation is inherent mobile browser toolbar-collapse behaviour interacting with the fixed bottom bars (`position: fixed` elements re-anchoring as the toolbar animates during scroll) — a known platform quirk, not reproducible or verifiable from this environment (no real device, no dynamic-toolbar simulation in Playwright). Not fixed; see Known problems.

## Verification performed

- `npx next build` — compiled successfully, TypeScript clean, checked after every change this session.
- Full Playwright smoke suite against a local dev server: 15 passed, 0 failed (one transient flake in `estimate-actions-no-nav-gap.spec.ts`, a real-AI-call test whose 5s polling window was occasionally too tight — bumped to 10s, confirmed green after).
- `line-item-qty-clear-does-not-lock.spec.ts`: both cases confirmed to fail on each prior broken version (AND-based, then OR-based) and pass on the final `quantityBased`-flag version.
- Labour-hour tuning verified with a direct, real `claude-haiku-4-5-20251001` call using the updated prompt against a job description matching the reported scenario.
- `new-circle-no-button-overlap.spec.ts`: confirmed failing (measured 6.5px overlap) before the padding fix, passing after; re-ran `estimate-actions-no-nav-gap.spec.ts` afterward to confirm the padding change didn't reopen the earlier gap bug.
- Share footer and detail-page overlap fix both reviewed via direct screenshot at a 375-412px mobile viewport, not just asserted.

## Known problems

- **Scroll jank on `/estimates/[id]` is not resolved.** Investigated and ruled out the leading code-level hypothesis (see above). The likely remaining cause is a mobile-platform quirk (fixed bottom bars + toolbar-collapse) that needs a real device or more specific detail from the user (which part of the screen moves, which browser/OS) before attempting a fix with any confidence — a speculative CSS change here was deliberately not made, since it could not be verified from this environment and risks a real regression across every page using the same fixed-bottom-bar pattern.
- `.claude/settings.local.json` and `.gitignore` still carry pre-existing, unrelated uncommitted changes, left for the user's own review.
- `.ai-control-centre/` and four `.bak-*` timestamped backup files remain untracked, still an open decision (gitignore vs. commit).
- Supabase custom domain for full Google OAuth consent-screen branding remains an open, optional decision.
- Carried over from the imported ChatGPT planning session, still undecided: the data model for business types/templates, the inspection-estimate schema and prompt changes, whether business type can change after onboarding, whether a third business type is warranted.
- Not independently re-verified today: the PDF render of a quantity-based line item against a real saved estimate (goes through the same already-verified `formatEstimateForDisplay` path, but a generated PDF file was not opened this session).

## Exact next action

Get more specific detail from the user on the scroll jank (which element visibly moves, device/browser) before attempting a fix. Separately, the carried-over Inspection Services planning question: propose the smallest implementation plan for adding that business type without changing existing Trades behaviour.

---
aiControlCentre:
  schemaVersion: 1
  status: Stable
  currentState: >-
    SPEC.md estimate-flow work is done and pushed to origin/main, plus five
    same-day follow-ups. Line item quantity/rate editing bug fixed twice (a
    first AND-to-OR fix solved the original edit-panel-vanishing bug but
    introduced a cost-zeroing bug on ambiguous AI rows; both now fixed by a
    quantityBased flag set once at parse time). Labour hour estimates tuned
    to be more realistic. Share page branding footer shrunk to a single
    attribution line. A New-button/action-button tap-target overlap
    introduced by the prior session's nav-gap fix is now fixed. Scroll jank
    on the estimate detail page was investigated: the leading hypothesis
    (double scroll container) was directly measured and ruled out; the
    likely remaining cause is a mobile browser platform quirk not fixable
    from this environment without more detail from the user. Build clean,
    smoke suite fully green at 15 passed.
  nextAction: >-
    Get more specific detail from the user on the scroll jank (which element
    moves, device/browser) before attempting a fix. Separately, propose the
    smallest plan for an Inspection Services business type without changing
    existing Trades behaviour.
  updatedAt: '2026-07-25T21:00:00.000Z'
---
