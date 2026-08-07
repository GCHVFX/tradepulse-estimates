# TradePulse handoff

Updated: 2026-08-06 (homepage proof/positioning and support-page redesign)

## Current state

- **Branch:** `main`
- **Deployed Production application commit:** see the Deployment section below (this session's `Improve homepage proof and support access` push)
- **Prior Production deployment:** `dpl_4BPGcwKZQ1erTjCMq9tz5gP9hmE5`, READY, Git-sourced from `4bc5b27` (`Fix account deletion storage type check`). The preceding Git deployment failed before Production changed because `StorageApiError.statusCode` is a string. The authorised corrective push fixed that comparison.
- **Pricing:** Starter is **CA$29/month** and Pro is **CA$59/month**. Stripe price IDs remain environment-driven. Production pricing and Checkout paths were verified during the completed cutover.
- **Communications:** remain disabled unless a future task explicitly authorises them.

## Completed product and platform work

### Stripe cutover acceptance

- Canonical Production webhook: `https://www.trytradepulse.com/api/billing/webhook`.
- Exact supported events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, and `invoice.payment_failed`.
- A Stripe-signed hosted Workbench delivery passed. Billing Portal configuration and a direct hosted Portal session passed within the no-payment limits.
- The five temporary `NEW_` Production Vercel variables were removed. Canonical Production Stripe variables remain, without recording values.
- Synthetic Stripe Checkout Sessions and their shared synthetic customer were cleaned up. Old-account and Parlay isolation checks passed. No real payment, card entry, email, or SMS occurred.

### Contact and support

- Public `/contact` is deployed, signed-out access is allowlisted, the homepage Support link works, and the sitemap includes `/contact`.
- Contact support paths cover account, estimates, billing/refunds, and privacy. Footer targets meet the 44px minimum at the verified mobile viewport.

### Owner administrative correction

- `gchansen@gmail.com` remains intact with Pro and complimentary access. Its stale Stripe customer and subscription references were cleared while existing estimates were preserved.

### Bottom navigation and account deletion

- The bottom navigation has one primary `New` estimate action. The duplicate Estimates-page header action was removed and remains removed.
- **Approved final design (2026-08-05), superseding all earlier descriptions of this section:** `app/components/bottom-nav.tsx` is a conventional flat four-column bar (`grid-cols-4`, one shared `itemClass()` helper). Rates, Estimates, New, and Profile all use the identical column structure — `py-2`, a 42px icon slot, `gap-1`, label — so icons and labels land on the same baseline across all four. New is emphasized only by colour: an orange (`#f59e0b`) Plus icon and orange label, plus a subtle 42px rounded-square background (`rgba(245,158,11,0.15)`) behind its icon. There is no circle, no floating/overlapping element, and New is not taller or wider than the other three items. Two earlier designs were tried and rejected in this same session: a 66px flush circle (no overlap, but the client wanted New visually distinct without a filled circle) and a 62px circle overlapping 12px above the bar (rejected as still reading as a dominant floating action button). Verified at 375×812 and 412×915: all four columns equal width, icon slots and labels pixel-identical across all four, no overlap above the bar, no horizontal overflow, 44px+ tap targets throughout.
- Profile contains a destructive Delete account section. It requires an exact `DELETE` confirmation and a sign-in no older than 15 minutes.
- The server-only route authenticates the caller, rechecks business ownership, rejects cross-origin requests, and cancels Stripe only when its stored customer and subscription match. It then removes owned Storage objects, calls the service-role-only transactional RPC for dependent database records, deletes the Auth user last, and clears the local session.
- The RPC locks the owned business and estimates, then deletes payment reminders, estimate changes, structured items, legacy line items, photo metadata, estimates, price-book items, the user-keyed rate limit, and the business. Missing Stripe objects and a retry after database completion are handled safely; failures before Auth deletion leave the user signed in.
- Hosted synthetic end-to-end verification passed: the authenticated production flow redirected to the signed-out homepage. Read-back confirmed the synthetic Auth user, business, estimate, dependent rows, and Storage object were all absent. The fixture had no Stripe customer or subscription, so no Stripe action ran. Other business, estimate, reminder, change, item, line-item, photo, and price-book counts were unchanged. The unrelated rate-limit pool count decreased by one between snapshots, so its unchanged state cannot be asserted from those snapshots alone.

## Verification actually run for the account UX release

- Focused Playwright unit tests: 11 passed.
- Complete safe unit suite: 123 passed.
- `npx.cmd tsc --noEmit`: passed.
- Targeted ESLint for the changed account and navigation files: passed.
- `npx.cmd next build`: passed. The only notices were the pre-existing `metadataBase` warnings.
- `git diff --check`: passed.
- Local signed-out delete request returned HTTP 401. Local signed-in browser checks covered `/estimates`, `/new`, and `/profile` at 390 by 844 and 1440 by 900 with no new console errors or horizontal overflow.
- Hosted sign-in, Profile delete confirmation, deletion redirect, and direct database/Auth/Storage read-back passed.

## Preserved local state and known limits

- Do not discard, reset, stash, clean, or commit the pre-existing unrelated changes: `.claude/settings.local.json`, `.gitignore`, `CLAUDE.md`, `CODEX.md`, `.ai-control-centre/`, the four `.bak-*` files, and `supabase/.temp/`.
- Existing full-lint baseline remains **7 errors and 18 warnings**. The account release did not change that baseline. Build warnings are the three existing `metadataBase` notices.
- The Stripe acceptance deliberately did not use a real card or send communications. Do not recreate its synthetic Stripe objects or repeat that audit without a new explicit need.
- The rate-limit count observation above is the only unresolved verification ambiguity from the hosted deletion. All owned synthetic records were directly read back as absent.

## Homepage proof and positioning (completed 2026-08-06)

All work below is implemented on `main`, deployed as the commit titled `Improve homepage proof and support access` (see `git log` for the exact SHA; this file avoids hardcoding it to prevent a circular reference at commit time).

### Final approved homepage structure (`app/page.tsx`, top to bottom)

1. Nav, hero, and the existing interactive `EstimateDemo` — unchanged. No second demo was added.
2. Contractor pain strip (slim row, right after the hero): "No more quoting after dinner", "No more rebuilding every estimate", "No more losing jobs to a faster quote".
3. Trust strip, "How it works" three-step section — unchanged.
4. Trade-specific examples, `app/components/TradeExamples.tsx` (new client component): tab selector for Plumbing / Electrical / Painting, heading "See what TradePulse creates", each panel marked **Example**, generic trade icons only, realistic job description + scope excerpt + 2-3 line-item names, no prices, no invented company names/customers/logos/testimonials/ratings/usage figures/endorsements.
5. Workflow showcase ("Review, edit, send, done"): 4-step grid covering what the hero demo doesn't show (light edits, send channels, the customer-facing view).
6. Benefits grid — unchanged.
7. Positioning section: "Fast estimates without another complicated business platform", short supporting copy (minimal setup, phone-first, not a CRM, not an enterprise field-service platform). No competitor names, no AI/SaaS jargon.
8. "After the estimate": one-line teasers for Reviews / Payments / Follow-Up (PRO-tagged), kept brief and non-duplicative of the fuller Pro pricing-card bullets.
9. Pricing (Starter **CA$29/month**, Pro **CA$59/month**, unchanged): AI Photo Estimates copy corrected to "Take a photo of the job and TradePulse uses it to help draft the estimate." (no diagnosis or exact-pricing claim).
10. FAQ — Step 1 and the "Do I need to be technical to use this?" answer both say contractors can **type or dictate** the job description; no wording implies typing is required.
11. Final CTA, footer — unchanged. Single primary CTA reusing the existing `/signup` (or `/subscribe` / `/new` for signed-in users) route; no second competing CTA.

### Support-page redesign (`app/contact/page.tsx`, plus new `app/components/CopyEmailButton.tsx`)

- Five compact, full-row `<a href="mailto:...">` topic links (Sign-in/account trouble, Estimate help, Billing or refund request, Privacy or data question, Something else), each with a correct subject and a short prefilled body (no private account data). Every decorative child (icon, text, chevron) is `pointer-events-none` so only the anchor itself is ever hit-tested; `touch-manipulation` added; no nested buttons, no `preventDefault`, no Next.js `Link` used for any mailto.
- Fallback block below the topic rows: "Can't open your email app?" with a native `mailto:` link showing the address, and a "Copy email address" button (`CopyEmailButton.tsx`, client component) with success ("Email copied.") and failure ("Couldn't copy automatically...") states, no dependency added.
- Hero and intro spacing tightened for mobile (hero `py-16 sm:py-20` → `py-6 sm:py-14`; the "Before you email" aside box hidden on mobile with its guidance condensed into one sentence shown inline instead, restored as a fuller box on `sm:`+; intro block `py-8 sm:py-10` → `py-4 sm:py-10`). First topic row now renders at y≈508px on a 390×844 viewport (was ≈1272px before this pass) — visible without scrolling. Desktop (1440×900) two-column layout unchanged in spirit, still balanced.
- Profile page (`app/profile/page.tsx`): added a plain muted-text "Support" link routing to `/contact`, placed between the profile form and the destructive Delete-account section — less prominent than any account/billing control, consistent with existing "Sign out" styling. Bottom navigation (`bottom-nav.tsx`) was not touched by any of this work.
- Public homepage footer "Support" link (already pointing to `/contact`) unchanged.

### Exact verification run for this release

- `npx tsc --noEmit`: passed.
- Targeted ESLint on all five changed/added files: passed, zero errors (2 pre-existing `<img>` warnings in `app/page.tsx`, unrelated to this work).
- Complete safe unit suite (`npx playwright test --config=playwright.unit.config.ts`): **123 passed**.
- `npx next build`: passed, only the three pre-existing `metadataBase` notices.
- `git diff --check`: clean (only benign LF/CRLF notices).
- Browser verification at 390×844, 412×915, 1440×900: no horizontal overflow at any size on either page; hero demo runs end to end to "Estimate saved"; trade tabs switch content correctly; all homepage CTAs route to the correct paths; all 5 contact mailto hrefs verified via rendered `href` and hit-tested (nothing intercepts); Copy Email Address success and failure paths both verified; only the pre-existing single `/api/profile` 401 (unauthenticated baseline) seen in console, no new errors.
- Hosted (production) verification: see the Deployment section immediately below.

### Deployment (2026-08-06)

*(filled in immediately after the push and hosted verification below completes)*

## Known existing lint and metadata warnings (unchanged baseline)

- Full-lint baseline remains **7 errors and 18 warnings**, unrelated to this release.
- Build warnings are the three pre-existing `metadataBase` notices (no `metadataBase` set in `app/layout.tsx`'s metadata export).
- Two pre-existing `<img>` (not `next/image`) ESLint warnings in `app/page.tsx` (logo images), unrelated to this release.

## Next milestone: review the homepage on production

Review the homepage on production, then decide whether any sections should be shortened or removed based on the full mobile scroll experience (the homepage gained five new sections this session: pain strip, trade examples, workflow showcase, positioning, and "After the estimate"). Do not begin new product work in this task — it is a review-and-trim decision, not a feature slice.

**Exact next action:** load `www.trytradepulse.com` on a real mobile device, scroll the full homepage, and judge whether the combined length reads as strong proof or as padding. Bring findings back before making any cuts.
