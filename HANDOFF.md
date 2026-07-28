# Handoff

Updated: 2026-07-28 PDT

## Current state

TradePulse Estimates' `main` branch is up to date through the prior session's work (line item edit bug, labour-hour prompt tuning, share footer, New-button overlap fix, `security-audit` skill — all committed and pushed as of `81622c8`/`030eed0`). This session adds a new feature on top, described below, **committed but not yet pushed** (pending user go-ahead).

## Work completed this session

**Monthly cap on Starter AI photo estimate generation.** Previously the AI photo-estimate feature (`/api/analyze-photo`, multi-photo vision analysis via `claude-sonnet-4-6`) was flatly Pro-only — Starter got a "PRO" badge and a hard block. Now Starter gets `STARTER_MONTHLY_PHOTO_LIMIT` (3) generations per calendar month, Pro stays unlimited. This is a real product change (Starter previously had zero access, not a loosened limit), confirmed with the user before implementing.

- **`lib/rate-limit.ts`** — added `STARTER_MONTHLY_PHOTO_LIMIT` (3) and `secondsUntilNextMonthUTC()`. No new table or RPC: reuses the existing `checkRateLimit()`/`increment_rate_limit()` mechanism (already used for signup, generate-estimate, the existing photo abuse-throttle), just with a window length computed to the next UTC calendar-month boundary instead of a fixed rolling window.
- **`app/api/analyze-photo/route.ts`** — replaced the flat `plan !== 'pro'` 403 with: Pro skips the check entirely (unchanged, still subject to the existing separate 5/hour abuse throttle); Starter calls `checkRateLimit(supabaseAdmin, business.id, "analyze-photo-monthly", 3, secondsUntilNextMonthUTC())` *before* any Anthropic call. On block, returns `{ error: "photo_limit_reached", message, remaining: 0, limit: 3 }` at 403 rather than a generic message, so the client can distinguish it. Keyed by `business.id` (not `user.id`), per-business per the requirement.
- **`app/api/profile/route.ts` (GET)** — for non-Pro businesses only, peeks (never increments) the current `tpe_rate_limits` row for `(business.id, "analyze-photo-monthly")` and returns `ai_photo_estimates_remaining` (number for Starter, `null` for Pro/unlimited). Piggybacks on a fetch the client already makes rather than adding a new endpoint.
- **`lib/hooks/use-business-profile.ts`** — threads `aiPhotoEstimatesRemaining` through.
- **`app/new/page.tsx`** — camera button now opens for Starter too (was Pro-only); shows "X of 3 AI photo estimates left this month" once known and under the cap; blocks the tap client-side with an upgrade-to-Pro message once at 0 (UX only — server is the real gate, verified independently). `handleGenerate()`'s `isPro &&` restriction on attempting photo analysis was removed so Starter's request actually reaches the server.
- **`CLAUDE.md`** — Photo Input section updated from "Pro-gated" to describe the new cap.

**Found and deliberately left alone:** `/api/estimates/[id]/analyze-photos` (plural) is a separate, unrelated route (describes photos on inbound website-quote-request estimates, cheap `claude-haiku-4-5-20251001`, already available to all plans, own existing 10/hour throttle) — confirmed it's not the route described in the request and didn't touch it.

**Known pre-existing gap, deliberately not fixed here:** `tpe_rate_limits` has no unique constraint on `(key, action)`, only a plain index — the `checkRateLimit()` upsert fallback isn't truly atomic against two simultaneous "first request of a new window" calls. Low-probability, low-stakes (worst case a business gets a couple of extra free generations right at a reset boundary), and pre-existing across every current use of this rate limiter, not introduced by this feature. Flagged to the user; fixing it would need a migration that also cleans up any duplicate rows that may already exist, out of scope of what was asked.

## Verification performed

- `npx next build` — compiled successfully, TypeScript clean.
- **Full Playwright smoke suite: 18 passed, 0 failed.**
- `photo-monthly-cap-server-enforced.spec.ts` (new) — real end-to-end test calling `/api/analyze-photo` directly (not through the UI, to prove the cap can't be bypassed by going around the client): 3 real Anthropic vision calls succeed, a 4th is blocked with `photo_limit_reached` before touching Anthropic, `/api/profile` correctly reports 0 remaining, flipping the business to Pro directly in the DB immediately unlocks a 5th real call and `/api/profile` reports `null` (unlimited).
- `photo-monthly-cap-ui.spec.ts` (new) — stubbed `/api/profile` responses, confirmed the remaining-count label and the blocked-state message with a working `/subscribe` link, screenshots reviewed directly at a 412px mobile viewport (not just asserted).

## Known problems

- This session's commit is **not pushed yet** — ask before pushing, per usual.
- `.claude/settings.local.json`, `.gitignore`, `DECISIONS.md` still carry pre-existing, unrelated uncommitted changes, left for the user's own review.
- `.ai-control-centre/` and four `.bak-*` timestamped backup files remain untracked — still an open decision (gitignore vs. commit).
- Scroll jank on `/estimates/[id]` (reported previous session) remains unresolved — leading hypothesis was ruled out by direct measurement; likely a mobile browser platform quirk, needs more specific detail from the user (which element moves, device/browser) before attempting a fix.
- Supabase custom domain for full Google OAuth consent-screen branding remains an open, optional decision.
- Carried over from an earlier imported ChatGPT planning session, still undecided: data model for business types/templates, inspection-estimate schema/prompt changes, whether business type can change after onboarding, whether a third business type is warranted.

## Exact next action

Confirm the user wants this session's commit pushed. Otherwise: get more specific detail on the scroll jank, or move to the carried-over Inspection Services planning question.

---
aiControlCentre:
  schemaVersion: 1
  status: Stable
  currentState: >-
    Added a monthly cap (3/calendar month) on Starter's previously Pro-only AI
    photo estimate feature, Pro unlimited. Reused the existing
    checkRateLimit/increment_rate_limit mechanism with a calendar-month-aware
    window rather than inventing new counting infrastructure. Enforced
    server-side in /api/analyze-photo before any Anthropic call; a
    remaining-count is exposed via /api/profile and shown proactively in the
    UI, with a client-side block (UX only) plus the real server-side block
    once exhausted. Verified end-to-end with real Anthropic calls proving the
    4th request is blocked and Pro remains unlimited. Build clean, smoke
    suite fully green at 18 passed. Committed locally, not yet pushed.
  nextAction: >-
    Confirm whether to push this session's commit. Otherwise: get more
    specific detail on the previously-reported scroll jank on
    /estimates/[id], or move to the carried-over Inspection Services planning
    question.
  updatedAt: '2026-07-28T00:00:00.000Z'
---
