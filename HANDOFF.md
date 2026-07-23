# Handoff

Updated: 2026-07-23 09:32 PDT

## Current state

TradePulse Estimates is deployed and working on `main` (latest commit `3176e0e`, pushed). This session added a live voice-dictation feature, redesigned the `/new` job-description input row and bottom navigation, moved Payments out of the bottom nav into an Estimates-page pill, fixed a production-blocking Permissions-Policy bug, resolved a Google OAuth publishing-status problem, and corrected several accuracy issues on the public landing page and legal pages.

## Work completed

- Added dictation: `POST /api/transcribe-audio` (`gemini-3.5-flash` via `@google/genai`), mic icon on `/new`, retry-with-backoff on transient Gemini errors. Not Pro-gated — available on Starter and Pro.
- Consolidated the `/new` job-description input row: mic + camera as two 48px icon buttons attached to the textarea corner (`PhotoSourceSheet` handles Take Photo / Camera Roll), replacing two full-width buttons that were pushing the form down the screen.
- Redesigned the bottom nav: Rates, Estimates, New, Profile (Payments tab removed — Pro-gated and low-frequency, but was costing a permanent slot for every user). New button repositioned to the one-handed thumb zone (measured at 62.5% of bar width).
- Added an "Unpaid Invoices" pill to `/estimates` (live count for Pro, PRO badge for Starter) as the new entry point to `/payments`.
- Fixed a real overlap bug between the redesigned nav and existing fixed action bars (`estimate-actions.tsx` bottom offset assumed the old, shorter nav height; `/new` button spacing needed the same correction) — found and fixed by measuring actual bounding boxes, not just eyeballing it.
- Fixed the live "Sign in with Google" flow: the OAuth client had been sitting in Google's "Testing" publishing status (100-user lifetime cap, 7-day forced re-consent for every user under that cap) — moved to production and added OAuth consent-screen branding (app name + logo) so the raw Supabase project domain no longer shows on the consent screen.
- Fixed the `Permissions-Policy` response header in `next.config.ts` (`microphone=()`) that was silently blocking microphone access site-wide since before dictation existed — this was the actual root cause of dictation not working in production, discovered only after ruling out browser- and OS-level permission causes.
- Landing page (`app/page.tsx`) accuracy pass: removed a stale/now-unfavorable Jobber price comparison and the ServiceTitan-only comparison table entirely (apples-to-oranges once Jobber no longer differentiated on price), added "Voice dictation" to the Starter feature list, marked "Customer Follow-Ups" as "(Coming Soon)" in the Pro list (feature isn't built yet), tightened mobile spacing on the Steps/Benefits sections, made the animated `EstimateDemo` hero mockup mobile-visible (was desktop-only despite the product being mobile-first) and fixed its stale bottom-nav rendering, removed a now-redundant static estimate mockup section further down the page.
- Terms of Service and Privacy Policy: corrected overstated claims ("collect payments", "manage customer follow-up" — neither is accurate to what's built) and added missing third-party disclosures (Google Gemini for voice transcription, Google Places for review-link lookup) plus a Photos/Voice recordings data-collection section.
- This backfill: registered this historical session with AI Control Centre; created this HANDOFF.md, PROJECT.md, and DECISIONS.md (all previously missing). Confirmed the CLAUDE.md/AGENTS.md managed instruction blocks were already current (v2) from a prior, separate update — no change needed there.

## Verification performed

- `npm run build` and targeted `npx eslint <file>` after every change this session — all passed clean (a small number of pre-existing, unrelated warnings were noted and left alone, never introduced by this session's edits).
- Live browser verification (not just build/lint) for every layout-affecting change, via the in-app Browser tool at multiple real viewport widths (340px, 375px, desktop): measured actual bounding-box geometry for the bottom nav reorder, the mic/camera button sizing and overlap fix, the `estimate-actions.tsx` offset fix, and the landing page's mobile Benefits/Steps grid.
- Dictation confirmed working end-to-end in production after the Permissions-Policy fix (user-provided screenshot showed a dictated phrase populate the textarea).
- Google OAuth consent screen confirmed showing "TradePulse" branding with no raw Supabase domain visible, and publishing status confirmed moved to "In production" by the user directly in Google Cloud Console.

## Known problems

- The Google OAuth consent screen's underlying redirect domain is still the raw `<project-ref>.supabase.co` string, since a Supabase custom domain (e.g. `auth.trytradepulse.com`) hasn't been purchased. Cosmetic only, not a security issue. Costs $10/month on top of a paid Supabase plan (Pro, $25/month minimum) — deferred pending a user decision on whether it's worth it.
- `.claude/settings.local.json` and `.gitignore` have pre-existing uncommitted changes unrelated to any application work from this session (present before this session started). Left untouched — not part of this backfill, not safe to commit without the user's own review.
- `.ai-control-centre/` and four `.bak-*` timestamped backup files (from a prior, separate managed-instruction-block update on 2026-07-22 and 2026-07-23) remain untracked in git, matching the same untracked state observed in sibling projects (routebuddy, sweepstakes) rather than a documented deliberate policy. Worth an explicit decision on whether `.ai-control-centre/` should be committed or gitignored going forward — see this session's final report for detail.

## Exact next action

None outstanding from this session's own work — everything requested is committed, pushed, and verified. The one open decision left for the user is whether to purchase a Supabase custom domain to fully brand the Google OAuth consent screen.

---
aiControlCentre:
  schemaVersion: 1
  status: Stable
  currentState: >-
    Deployed and working on main (3176e0e). Dictation, nav redesign,
    Payments-to-pill migration, and landing/legal page accuracy fixes all
    shipped this session.
  nextAction: >-
    None outstanding from this session. Optional: decide whether to purchase a
    Supabase custom domain to fully brand the Google OAuth consent screen.
  updatedAt: '2026-07-23T16:35:19.880Z'
---
