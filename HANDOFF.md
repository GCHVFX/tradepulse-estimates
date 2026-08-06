# TradePulse handoff

Updated: 2026-08-05 (bottom navigation redesign)

## Current state

- **Branch:** `main`
- **Deployed Production application commit:** `4bc5b27` (`Fix account deletion storage type check`)
- **Production deployment:** `dpl_4BPGcwKZQ1erTjCMq9tz5gP9hmE5`, READY, Git-sourced from `4bc5b27`, serving `www.trytradepulse.com` and project aliases. The preceding Git deployment failed before Production changed because `StorageApiError.statusCode` is a string. The authorised corrective push fixed that comparison.
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

## Next milestone: homepage proof and positioning

Keep Estimates as the primary product. Preserve the existing hero and interactive demo. Do not add a second demo.

1. Add a compact contractor-pain strip:
   - No more quoting after dinner
   - No more rebuilding every estimate
   - No more losing jobs to a faster quote
2. Add trade-specific **Example** content for Plumbing, Electrical, and Painting, using generic trade icons only. Include realistic job input, scope excerpts, and representative line items. Do not invent company names, logos, testimonials, ratings, customers, usage figures, or endorsements.
3. Show the rest of the actual workflow: generated estimate, light editing, sending, and the customer-facing result.
4. Position TradePulse as fast, mobile-first estimating with minimal setup, not a full CRM or enterprise field-service platform.
5. Keep Reviews, Payments, and Follow-Up secondary and describe only verified available behaviour.
6. Improve the final CTA and relevant homepage metadata without changing pricing.
7. Complete the related homepage work locally, then stop for visual approval before one combined Production deployment.

**Exact next action:** begin the homepage proof and positioning work locally on `main`, starting from this handoff. Do not redeploy until the complete slice has visual approval.

**Recommended next task:** Codex GPT-5.6 Terra, Medium effort. Raise to High only if the homepage work exposes a difficult regression or unclear shared-component interaction.
