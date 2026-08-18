# TradePulse handoff

Updated: 2026-08-17 (Preview billing recovery reviewed; Production preflight pending)

## Current state

- **Branch:** `fix/cost-amplification-guards` from `main` commit `6856303`.
- **Cost-amplification guards:** committed and pushed on this branch at `6048ff05d9cf1f8269d1b966c9374330142bf346`, with Preview-only testing in progress. They are not merged to `main` or deployed to Production. The applied remote migration `20260817044348_cost_amplification_guards` matches the repo file of the same name. It deduplicates existing rate-limit rows, makes `(key, action)` unique, adds atomic `take_rate_limit`, and adds service-role-only durable delivery claims. The additive remote migrations `20260817145800_add_photo_upload_reservations`, `20260817150102_cleanup_photo_upload_reservations`, and `20260817150442_fix_photo_reservation_file_count` match the repo files of the same names, atomically reserve business photo count and byte capacity before Storage writes, count pending requested files rather than batches, and delete handled reservation rows.
- **Deployed Production application commit:** `6856303`, deployment `dpl_Dbbzmd4GRX9QN6YAtkbYyi2FQU6c`, READY. It is the current `main` deployment and does not include the cost-amplification guards or Preview billing recovery.
- **Prior Production deployment:** `dpl_F3No6EAu8FLbYH6GSRjLXt5qe8BZ`, READY, Git-sourced from `a58cc00` (`Improve homepage proof and support access`).
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

- Commit `a58cc00` ("Improve homepage proof and support access"), pushed to `origin/main`.
- Vercel deployment `dpl_F3No6EAu8FLbYH6GSRjLXt5qe8BZ` reached **READY**, aliased to `www.trytradepulse.com` and the other project aliases. No manual redeploy was used.
- Hosted verification on production: homepage returns 200, Starter $29 / Pro $59 confirmed in rendered text, new sections (pain strip, trade examples heading, AI Photo Estimates copy) confirmed present, no horizontal overflow at 390px, trade tabs switch content correctly (verified clicking through to the Painting panel), the hero demo runs end to end to "Estimate saved". `/contact` returns 200, all 5 topic-row `mailto` hrefs verified correct, first row renders at the same y≈508px as local. Network log showed no 5xx responses; console showed only the expected unauthenticated `/api/profile` 401 baseline, no new errors.
- **Not verified this session:** the Profile Support link while actually signed in, and whether tapping a topic row opens a real mail app on a physical device — both require credentials/hardware this agent doesn't have. Code for both was verified by inspection and local/hosted DOM checks only.

## SMS opt-out and payment-reminder message preview (2026-08-07)

Implemented and locally verified across four sessions; committed and deployed as noted below. Reasoning for the durable decisions here is in DECISIONS.md, not repeated in full.

### Inbound Twilio webhook

- Route: `app/api/webhooks/twilio-inbound/route.ts` (POST). Validates Twilio's `X-Twilio-Signature` via the official `twilio.validateRequest`, against `${NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com"}/api/webhooks/twilio-inbound`.
- Handles `OptOutType=STOP` / `START` / `HELP`; falls back to parsing Twilio's documented keyword set from `Body` (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT, START/YES/UNSTOP, HELP/INFO) when `OptOutType` is absent, so it works correctly even before Advanced Opt-Out is confirmed enabled in Console.
- STOP/START are idempotent (compare-and-swap UPDATE-then-INSERT in `lib/sms-suppression.ts`); a duplicate webhook delivery is a safe no-op. HELP is a recognized no-op that changes nothing locally (Twilio's own Advanced Opt-Out reply already answers it). Always returns empty TwiML; this app never sends a second opt-out confirmation.
- Never references `tpe_estimates` or `payment_status` anywhere in its code path — structurally cannot mutate invoice/customer/payment state, confirmed by test.

### Suppression data model

- `public.tpe_sms_suppressions`: `phone` (unique, E.164), `sms_opted_out`, `opted_out_at`, `opted_in_at`, `last_message_sid`. RLS enabled, no policies (matches every other `tpe_` table; service-role access only).
- Global by normalized phone number, not scoped to a business or estimate — see DECISIONS.md for why.

### Every SMS send path is protected

- `app/api/cron/payment-reminders/route.ts` (automated daily cron)
- `app/api/send-sms/route.ts` (manual "Send Estimate" SMS)
- `app/api/estimates/[id]/review-request/route.ts` (Google review request SMS)
- All three check suppression before ever calling Twilio, and return `{ error: SMS_OPTED_OUT_MESSAGE, code: "sms_opted_out" }` (HTTP 409) instead of a generic failure. Twilio error 21610 is caught by one shared `recordSuppressionIfUnsubscribedError()` helper in all three (idempotent, no retry). No other Twilio call site exists in the codebase.

### Payment-reminder message format

Centralized in `lib/payment-reminder-message.ts` (`buildPaymentReminderSms()`), the single function both the production cron and the Profile Message Preview call — they cannot drift from each other.

- With a payment link: `"{Business}: Invoice #{ref} for ${amount} {lead-in}. Pay here: {link}. Reply STOP to stop text reminders."`
- Without one: `"{Business}: Invoice #{ref} for ${amount} {lead-in}. Please arrange payment at your earliest convenience. Reply STOP to stop text reminders."`
- Stage lead-ins preserved: `pre_due` "is due {date}", `overdue_1` "was due {date}", `overdue_2` "remains outstanding as of {date}", `overdue_ongoing` "remains unpaid".
- No "your contractor" fallback in the SMS path; a blank business name just omits the prefix. The email path is unrelated to this change and keeps its existing "your contractor" fallback.

### Contractor-facing behaviour

- Estimate detail (`app/components/estimate-actions.tsx`): amber "SMS opted out" banner on an affected unpaid invoiced estimate ("Customer opted out of text reminders. Follow up another way. The invoice is still unpaid, this does not change the balance."), with an "Email Customer" action reusing the existing `SendEstimateSheet` (opens directly to its email panel, prefilled) or "No email on file. Follow up by phone or in person." when there's no email on file.
- `/payments` unpaid-invoices list: same "SMS opted out" tag on affected rows, one batched suppression lookup for the whole list.
- No new contractor-facing email notification system was built. Checked for a reusable one first (`notify-error`, `new-signup`) — both only notify a fixed admin address, not the business owner — so building one would have been new scope; the in-app banner and list tag are the notification.

### Message Preview

Profile → Pro Features → directly beneath the Payment link field.

- Calls `buildPaymentReminderSms("overdue_1", ...)` with the contractor's live (pre-save) business-name and payment-link field state, plus fixed example invoice values (`#1042`, `$350`, `August 4, 2026`) — never real customer data, since a real invoice only exists at send time.
- Updates before save: reads the same `useState` the input fields already write to on every keystroke, no separate preview state to fall out of sync. Verified live in the browser (business name and payment-link edits both).
- Read-only: no textarea, no editable STOP wording, no editable business-name prefix, no per-stage template editing, no advanced messaging settings.
- Payment-link field's helper text: "Payment reminders include this link so customers can pay directly from the text." (replaced the prior similar-purpose text rather than showing both).

### Migration status

`supabase/migrations/20260807000000_create_tpe_sms_suppressions.sql`, applied via the Supabase MCP `apply_migration` tool on 2026-08-07, recorded in `supabase_migrations.schema_migrations` as `20260807051039 create_tpe_sms_suppressions`. Confirmed present in the live project (`fctequqcwxyhmnjgxixg`) before this release: table exists, RLS enabled, 0 rows. `lib/database.types.ts` regenerated and confirmed byte-identical to the freshly-generated live schema, no drift, no unrelated database object touched.

### Verification actually run

- Complete safe unit suite including all new/extended SMS and Message Preview test files: **173 passed**, 0 failed.
- `npx tsc --noEmit`: clean.
- Targeted ESLint on every changed/added file: clean except pre-existing baseline warnings/errors, individually confirmed via `git diff` inspection each session to be lines this work never touched (`app/estimates/[id]/page.tsx`'s one `<a>`-vs-`<Link>` error, unused-prop warnings in `send-estimate-sheet.tsx` and `profile-form.tsx`, one `useEffect` dependency warning).
- `npx next build`: passed, only the three known `metadataBase` notices.
- `git diff --check`: clean, only benign LF/CRLF notices.
- Manual browser verification across sessions via temporary isolated preview routes (props-driven, no auth needed, always removed after use along with their `proxy.ts` entry): SMS-opted-out banner and its Email Customer fallback, Message Preview live-updating from both business-name and payment-link field edits, no-link fallback, long-payment-URL wrapping with no overflow, 390×844 / 412×915 / 1440×900 all clean, no new console errors beyond the known baseline unauthenticated `/api/profile` 401.
- **Not verified: a real STOP/START SMS round-trip against a live Twilio number.** Deliberately deferred — see below.

### Production deployment

- Commit `3e4e0c0` ("Add SMS opt-out handling and reminder preview"), pushed to `origin/main`.
- Vercel deployment `dpl_DTaE51jTE2U5JvDFLUX9fBWq2epx` reached **READY**, aliased to `www.trytradepulse.com` and the other project aliases. No manual redeploy used.
- Hosted verification: `/api/webhooks/twilio-inbound` returns 405 for GET (route deployed, POST-only, correct), `/profile` redirects unauthenticated visitors to sign-in (correct, not a 5xx), homepage loads clean with no horizontal overflow at 390×844 or 1440×900, only the known baseline unauthenticated `/api/profile` 401 in console, no 5xx anywhere. The Message Preview itself was not re-verified live in production under a real signed-in Pro account (no credentials available to this agent); the deployed code is byte-identical to what was verified locally via the isolated preview route earlier this session.

### External Twilio configuration still required

- The inbound webhook URL (`https://www.trytradepulse.com/api/webhooks/twilio-inbound`) is not yet configured anywhere in Twilio Console. Until "A MESSAGE COMES IN" → Webhook → POST is set to that URL on the number/messaging configuration actually sending TradePulse's SMS, no inbound STOP/START/HELP will ever reach this app, regardless of how correct the code is.
- Whether Twilio Advanced Opt-Out is enabled on that number/messaging configuration is unverified — this agent has no Twilio Console access (no MCP tool for it). The inbound webhook's own keyword-based fallback parser (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT etc.) works correctly either way, but Advanced Opt-Out is the carrier-compliant, officially-supported path and should be turned on regardless.

### Fresh-account production acceptance test remains mandatory after Twilio setup

Once the inbound webhook is configured, a full production acceptance pass is required before this feature is considered launch-ready: a fresh/synthetic test account (this project's local dev shares the same Supabase project and live Stripe as production — see memory notes on that), a real invoice, a real STOP reply confirmed to suppress future reminders, a real START reply confirmed to restore eligibility, and cleanup of every synthetic record afterward. Explicitly not performed this session, per instruction.

## Manual payment reminders and mobile action-bar fix (2026-08-07)

Implemented, locally verified, committed, and deployed as noted below. Durable reasoning for the "manual sends are independent of the automated schedule" decision is in DECISIONS.md, not repeated in full.

### Send Reminder Now (manual per-invoice reminder)

- Route: `POST /api/estimates/[id]/send-reminder/route.ts`. Signed-in owner required, `hasProPaymentsAccess()` required, the invoice must belong to the caller's own business (matched by `id` **and** `business_id` in one query), `payment_status` must be `unpaid`, `invoice_amount` and `due_date` must both be set. Never callable anonymously, never touches any invoice other than the one requested.
- Reuses the same production primitives as the cron: `buildPaymentReminderSms()` / `buildPaymentReminderEmailBody()` / `buildPaymentReminderEmailHtml()` from `lib/payment-reminder-message.ts`, and the same suppression-guard-then-send-then-21610-handling pattern from `lib/sms-suppression.ts`. No duplicated message-building or send logic.
- `reminder_count` only advances when at least one channel actually sent, via a compare-and-swap update (`.eq("reminder_count", currentReminderCount)`) so a duplicate tap or a same-moment cron run can't double-advance it. Never touches `payment_status`, `invoice_amount`, or `due_date`.
- UI (`app/components/estimate-actions.tsx`): the old "Send Payment Reminder" button (which only opened the invoicing sheet) is relabeled **"Invoice This Job"** — accurate to what it actually does. A new **"Send Reminder Now"** button appears only when the estimate is invoiced, unpaid, and the business has Pro Payments access. Tap → inline "Confirm — send reminder now?" → tap again → "Sending..." (disabled, prevents duplicate taps) → one of the result strings shown below the button ("Reminder sent by text and email", "Reminder sent by text", "Reminder sent by email", "SMS opted out. Reminder sent by email.", "SMS opted out. No email address available.", "No customer contact method available.", "Reminder could not be sent").

### Manual stage selection is deliberately not the cron's schedule

- The cron's own `computeNextReminderStage()` (`lib/payment-reminder-stage.ts`) is **unchanged** and remains fully schedule-driven (2 days pre-due, 1/5/14+ days overdue), used only by `app/api/cron/payment-reminders/route.ts`.
- The manual route uses a separate function, `selectManualReminderStage()`, that never refuses for timing reasons: future due date → `pre_due` wording (any distance out, not just the cron's 2-day window); due today/overdue with nothing sent yet → `overdue_1` wording, however overdue; due today/overdue with a prior reminder already sent → whichever of `overdue_1` / `overdue_2` / `overdue_ongoing` actually matches how overdue the invoice is now, using the same day thresholds the cron uses. It only refuses for the invoice-state guards listed above (unpaid, amount/due date present, Pro access, ownership), never because "the schedule doesn't say so yet."
- **Cron/manual duplicate protection:** the manual send's resulting `reminder_count` is set to the same stage-index value the cron's own indexing would use for reaching that stage (not a naive `+1`), and never regresses below what's already recorded. That means an immediate subsequent cron run correctly sees that stage as already covered and does not resend the identical wording — the two selection functions stay independent, but their `reminder_count` bookkeeping stays compatible.

### SMS opt-out / email fallback (manual route)

- Identical guard order to every other SMS path: suppression checked before Twilio is ever called; Twilio 21610 is caught via the shared `recordSuppressionIfUnsubscribedError()` helper (idempotent, no retry).
- SMS and email are fully independent — a suppressed or failed SMS never blocks the email attempt, and vice versa. If SMS is suppressed but email succeeds, the send is still treated as successful ("SMS opted out. Reminder sent by email.").
- If no channel can actually send (no phone and no email, or all attempted channels fail), `reminder_count` and `last_reminder_sent_at` are left untouched — nothing is recorded as sent.

### Mobile estimate action-bar white-strip fix

- Cause: `estimate-actions.tsx`'s fixed bar used `bottom-[90px]`, based on a stale comment assuming `BottomNav` was ~93.5px tall (an older floating-circle design). `BottomNav` was redesigned to a flat 87px bar and the offset was never revisited — the intended ~3.5px overlap became an actual 3px *gap*, exposing the white estimate card underneath.
- Fix: corrected to `bottom-[84px]` (matching a real 87px `BottomNav` measurement), plus a `ResizeObserver` that publishes the action bar's real height as the `--tp-estimate-action-bar-height` CSS custom property. `app/estimates/[id]/page.tsx`'s `<main>` bottom padding now uses `calc(var(--tp-estimate-action-bar-height, 200px) + 108px)` instead of a static guessed `pb-[14rem]`, since the bar's real height ranges from ~100px (one button) to 400px+ (several stacked panels) depending on estimate state.
- Verified at 390×844 and 412×915: no white strip, all real content reachable by scrolling above the fixed bar, no horizontal overflow.

### Verification actually run (local)

- Focused tests: `tests/smoke/manual-payment-reminder.spec.ts` (30 tests), `tests/smoke/payment-reminder-copy.spec.ts`, `tests/smoke/sms-suppression-guard.spec.ts`, `tests/smoke/payment-reminder-message-preview.spec.ts` — **71 passed**, 0 failed.
- `npx tsc --noEmit`: clean.
- Targeted ESLint on every changed/added file: clean except the pre-existing, unrelated `<a>`-vs-`<Link>` error in `app/estimates/[id]/page.tsx:110`, individually confirmed via `git diff` inspection to predate this work.
- `npx next build`: passed.
- `git diff --check`: clean, only benign LF/CRLF notices.
- Manual browser verification via a temporary isolated preview route (props-driven, no auth needed, removed after use along with its `proxy.ts` entry): unpaid+Pro shows "Send Reminder Now", paid/not-invoiced/non-Pro/opted-out states all render correctly (opted-out still shows the button, with the "SMS opted out" banner and email fallback beside it), full click→confirm→send→result cycle verified against the real route (received the real route's 401 when unauthenticated, confirming the request actually reached the server), no horizontal overflow at 390×844 or 412×915.
- **Not verified this session: a real SMS/email send.** Deliberately not performed — see "Exact next action" below.

### Production deployment

- Commit: see "Current state" above once updated post-push.
- Vercel deployment ID and READY status: recorded once confirmed post-push.
- Hosted verification: recorded once confirmed post-push.

**Exact next action:** perform the controlled production payment-reminder STOP/START test using one test invoice and the owner's own phone number (same outstanding action already queued for the SMS opt-out feature above — this release doesn't add a new Twilio configuration requirement, it reuses the already-deployed inbound webhook and suppression store).

## Cost-amplification guard verification and next action

- Migration reconciliation: Supabase records `20260817044348_cost_amplification_guards`; local source was renamed from `20260817044143_cost_amplification_guards.sql` after its applied functions, constraints, RLS state, comment, and service-role grants were confirmed to match. Its SQL was not re-run.
- Photo uploads now take a service-role-only atomic reservation for the requested business, estimate, file count, and byte count. The reservation includes the full requested file count and bytes from pending uploads in the business quota, is deleted after success or handled failure, and stale pending reservations stop consuming quota after 15 minutes if an invocation terminates before cleanup.
- Delivery claims remain deliberately cost-safe: a provider failure after a successful claim can block automatic retry. Manual support recovery is required until a deliberate, rate-limited recovery flow is implemented.
- The focused claim-ordering test now checks an awaited claim and its negative-claim guard before each Twilio or Resend call. Re-run the focused test, full safe suite, typecheck, build, and `git diff --check` before any commit.

### Preview smoke-test attempt (2026-08-17)

- `fix/cost-amplification-guards` was pushed to `origin` at `6048ff05d9cf1f8269d1b966c9374330142bf346`. Its Git-triggered Vercel Preview deployment `dpl_8yWoVkhGaHYzub67ZEKRytPitHXS` failed before becoming testable.
- The Preview build compiled and completed TypeScript, then failed while collecting page data because `STRIPE_SECRET_KEY` is not configured for the Preview environment. It is Production-only. Do not copy the Production key. Configure isolated Stripe **test-mode** Preview credentials and matching test price IDs before retrying.
- Initially, `GOOGLE_PLACES_API_KEY` was absent from Production and Preview. It was later added to Preview only; it remains absent from Production.
- The payment-reminder cron remains configured in `vercel.json`, but Vercel cron jobs run only on Production, so the failed Preview did not invoke it. No Preview route was requested and no test account, customer data, SMS, email, Stripe Checkout Session, payment, or Google Places request was created.
- Local verification in this session: `git diff --check`, `npx.cmd tsc --noEmit`, focused guard tests (4 passed), and full safe unit suite (208 passed). Local `npx.cmd next build` could not fetch the public DM Sans font in this execution environment; Vercel's own build passed compilation and TypeScript before the missing Preview Stripe configuration stopped it.

### Ready Preview follow-up (2026-08-17)

- A later Preview redeploy, `dpl_9a92hxCKqTWNtY5g8Ba5A8uw56dr`, is READY at `https://tradepulse-estimates-a27y0qpuo-gchansen-2620s-projects.vercel.app` and its metadata confirms `6048ff05d9cf1f8269d1b966c9374330142bf346`. Its homepage returned 200.
- Vercel environment names confirm `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID`, and `GOOGLE_PLACES_API_KEY` are Preview-only, while `GOOGLE_PLACES_API_KEY` remains absent from Production. Preview has no `STRIPE_PRO_PRICE_ID` or `STRIPE_WEBHOOK_SECRET`. The READY deployment above was built before `STRIPE_PRICE_ID` was added, so its running `/api/billing/checkout` route still reports that variable as missing.
- A Preview POST to `/api/profile/find-review-link` without authentication returned 401 before a Places lookup. A Preview POST to `/api/billing/checkout` without authentication redirected to `/login`; neither call created a Checkout Session or contacted a provider. Cron was not invoked.
- The remaining controlled smoke checks were completed in the authenticated session below, except Checkout, which must not be retried against this already-built deployment.

### Authenticated Preview smoke test (2026-08-17)

- A controlled Preview account signed in successfully. One small synthetic, no-customer estimate was generated and the authenticated estimate list contained its generated ID exactly once. This invoked one expected Anthropic estimate-generation call.
- One controlled password-reset request returned the generic `{ ok: true }` response. No SMS was sent. The reset route was exercised once only and may have invoked one expected Resend send.
- One Starter Checkout POST was attempted with the Preview origin and without following any redirect. It returned HTTP 500 before a Checkout redirect. Deployment logs show `[checkout] STRIPE_PRICE_ID not configured`, so no Checkout Session, card entry, or payment occurred. Do not retry against this deployment.
- One 1x1 valid PNG logo upload returned 200. One authenticated synthetic Google Places lookup returned 404 (no matching business) rather than a configuration error. The route may issue up to four Google search requests per one guarded lookup. Vercel environment names confirm the Places key is Preview-only and absent from Production.
- Cron was not invoked. Provider dashboards were not accessed, so no dashboard usage delta was independently verified. No unexpected app-side provider request was identified beyond the one estimate generation, one controlled reset request, and one guarded Places lookup described above.

**Exact next action:** after confirming the Preview `STRIPE_PRICE_ID` is a test-mode price, allow one Git-triggered Preview deployment so the new environment applies, then rerun only the single Starter Checkout test. Do not merge or deploy Production until that succeeds and provider dashboard caps are verified. No real customer message, card, or Production checkout was used.

### Preview Pro-upgrade stale-reference recovery (2026-08-17)

- Latest Preview deployment: `dpl_7PQhtzUh875YRPf4FQWRrrACgJ1Y`, READY at `https://tradepulse-estimates-az0rcg8q7-gchansen-2620s-projects.vercel.app`. It is Preview-only and was never promoted.
- The earlier Pro-upgrade failure was confirmed as stale saved Stripe customer and subscription references on the controlled synthetic Preview account. Both objects were absent from the connected TradePulse Stripe sandbox. Only that account's `tpe_businesses.stripe_customer_id` and `tpe_businesses.stripe_subscription_id` were cleared, while its Starter plan and trial status were preserved.
- `app/api/billing/upgrade/route.ts` now validates saved references before reuse. A missing saved customer clears both references and starts fresh Checkout; a missing subscription clears only that reference; valid trial references are retained for the existing metadata path. Non-missing subscription lookup failures retain the existing log-and-continue behaviour. `lib/stripe-billing-recovery.ts` and `tests/smoke/stripe-billing-recovery.spec.ts` cover those cases; `playwright.unit.config.ts` includes the focused test.
- One authorized Preview Pro-upgrade POST then returned HTTP 200 with a Stripe sandbox Checkout redirect. The URL was not opened and no card or payment was used. Read-back confirms a fresh sandbox customer is stored for the synthetic account and no completed subscription is stored. Vercel runtime logs record the request as HTTP 200 with no route error.
- Verification: `git diff --check` passed, `npx.cmd tsc --noEmit` passed, focused stale-reference tests passed (3), and the full safe unit suite passed (211). Local `npx.cmd next build` remains blocked only by this environment's failed public DM Sans fetch; the new Vercel Preview build passed compilation, TypeScript, page generation, and READY deployment.

**Exact next action:** verify provider dashboard caps and alerts before any Production deployment. Keep Vercel cron disabled and Google Places absent from Production. The reviewed recovery work is ready for its authorised local commit; do not push or deploy it until explicitly authorised.

## Known existing lint and metadata warnings (unchanged baseline)

- Full-lint baseline remains **7 errors and 18 warnings**, unrelated to this release.
- Build warnings are the three pre-existing `metadataBase` notices (no `metadataBase` set in `app/layout.tsx`'s metadata export).
- Two pre-existing `<img>` (not `next/image`) ESLint warnings in `app/page.tsx` (logo images), unrelated to this release.

## Next milestone: Twilio configuration and the real STOP/START acceptance test

This blocks the SMS opt-out feature from being launch-ready even though the code is deployed. Nothing in this milestone can be done by an agent without Twilio Console access.

1. In Twilio Console, on the number/messaging configuration TradePulse actually sends from: set "A MESSAGE COMES IN" → Webhook → POST → `https://www.trytradepulse.com/api/webhooks/twilio-inbound`.
2. Confirm (don't assume) whether Advanced Opt-Out is enabled on that same configuration; enable it if not.
3. Perform one controlled real STOP/START SMS test against a real phone the operator controls, confirming TradePulse records suppression on STOP and restores eligibility on START.
4. Perform the full fresh-account production acceptance test described above (synthetic account, real invoice, real STOP/START, verified suppression, cleanup).

**Exact next action:** configure Twilio inbound messaging and Advanced Opt-Out as above, then perform the controlled real STOP/START SMS test, then the fresh-account production acceptance test.

## Queued after that: review the homepage on production

Review the homepage on production, then decide whether any sections should be shortened or removed based on the full mobile scroll experience (the homepage gained five new sections in an earlier session: pain strip, trade examples, workflow showcase, positioning, and "After the estimate"). Do not begin new product work in that task — it is a review-and-trim decision, not a feature slice. Load `www.trytradepulse.com` on a real mobile device, scroll the full homepage, and judge whether the combined length reads as strong proof or as padding, before making any cuts.
