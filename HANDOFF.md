# Handoff

Updated: 2026-08-05

**Branch:** `main` at `1fd3274` (`Record contact page deployment`) before the account UX release commit. Every pre-existing dirty file remains preserved and excluded from task commits: `.claude/settings.local.json`, `.gitignore`, `.ai-control-centre/`, and four `.bak-*` files.

## Current release candidate (2026-08-05): account navigation and self-service deletion

- The centred mobile `New` control is now a 66px connected action with aligned labels, safe-area padding, an 80px screen-centred target, and no duplicate header create control on Estimates. Rates, Estimates, New, and Profile all have at least 44px targets at 390 by 844. Desktop constrains the bottom control group while retaining the same centred New action.
- Profile now includes a guarded Delete account section. It requires exact `DELETE`, a sign-in no older than 15 minutes, blocks repeat submission, rejects cross-origin requests, and shows errors without an early sign-out.
- The protected route rechecks business ownership, cancels only a matching stored Stripe subscription, removes owned photo objects, then invokes `tpe_delete_business_account_data`. The live service-role-only RPC deletes payment reminders, estimate changes, structured items, line items, photo metadata, estimates, price-book items, the user-keyed rate limit, and the owned business under a row lock. Auth deletion and local session clearing are last. Missing Stripe objects and a missing business after partial completion are retry-safe.
- Added focused account-deletion and bottom-navigation tests. Final local checks passed: 123 safe unit tests, TypeScript, targeted ESLint, `next build`, `git diff --check`, unauthenticated delete returned HTTP 401, and signed-in synthetic UI checks passed at 390 by 844 and 1440 by 900 with no new console errors or horizontal overflow. The only build notices are the pre-existing `metadataBase` warnings.
- A confirmed, clearly labelled synthetic local account with only synthetic business, estimate, dependency, and Storage-photo data is signed in and ready for the final deletion action. It has no Stripe customer, subscription, payment, card, email, or SMS. No real account was touched.
- The one permitted Git push created deployment `dpl_4okVsBWJbCgVVqHatZGvxZsFF3wF`, but it failed before Production changed because `StorageApiError.statusCode` is a string and the route compared it to numeric `404`. The one-line correction is local, type-checked, linted, and build-verified. It needs an explicitly authorised corrective push because that would create a second Git deployment.

### Exact next action

If authorised, commit and push the one-line deployment correction, then wait for the resulting Git deployment to reach READY. Repeat the signed-in synthetic verification on Production and complete its authorised final delete action, read back all synthetic data removal, and record the hosted result in a local handoff-only commit without another push.

## Latest session (2026-08-05): contact/support integration and Production deployment

### Outcome

- Integrated the completed public contact/support slice by cherry-picking `e4bdcb2347dd63e465952cf5daeaa05a4f655631` as `7c5a0ec` (`Add public contact support page`). It adds the public `/contact` route, practical account, estimate, billing/refund, and privacy support guidance, homepage Support link, sitemap entry, and `/contact` proxy allowlist entry.
- The only cherry-pick conflict was `HANDOFF.md`. The incoming summary was stale relative to the verified CA$29/CA$59 pricing and completed Stripe cutover acceptance, so the current version was kept and this entry records the contact result. No Stripe, Supabase, Vercel-variable, Checkout, Portal, webhook, or customer-data behaviour changed.
- Mobile verification found that the short footer links had 44px height but not 44px width. `f871d3e` (`Ensure contact footer tap targets`) adds `min-w-11` and centred alignment to the three footer links. At 390 by 844, no visible target is below 44 by 44px and there is no horizontal overflow.
- `main` was pushed once from `fadebfb` to `f871d3e`. Git created exactly one Production deployment, `dpl_Dr3RTZNHWn6fExHHbVaw5xrZWVSj`, which reached READY from `f871d3e` and owns `www.trytradepulse.com`, `trytradepulse.com`, and the project aliases. No manual deployment or rollback occurred.

### Verification performed

- Complete safe unit suite: 112 passed. `npx.cmd tsc --noEmit`: passed. Targeted ESLint on `app/contact/page.tsx`, `app/page.tsx`, `app/sitemap.ts`, and `proxy.ts`: no errors and only the two known `app/page.tsx` image warnings. `npx.cmd next build`: passed with `/contact` static in the 53-route build and three existing `metadataBase` warnings. `git diff --check`: passed.
- Signed-out local checks: `/contact`, `/`, `/login`, `/terms`, `/privacy`, and `/sitemap.xml` each returned HTTP 200; sitemap contains `https://trytradepulse.com/contact`; homepage Support navigates to `/contact`; unsigned `POST /api/billing/webhook` reached the route and returned HTTP 400 rather than an authentication block.
- Local browser checks: `/contact` rendered correctly at 390 by 844 and 1440 by 900 with no horizontal overflow. Browser console had no errors in a fresh signed-out local tab. All visible contact-page links had at least 44 by 44px targets after the footer fix. Homepage continued to render the verified `$29` Starter and `$59` Pro amounts.
- Hosted checks: `https://www.trytradepulse.com/contact`, homepage, login, Terms, Privacy, and sitemap each returned HTTP 200; hosted sitemap contains the `/contact` entry; hosted homepage Support navigates to `/contact`; hosted homepage continues to render `$29` and `$59`; hosted contact-page browser console had no errors. Vercel found no `/contact` runtime errors in the last hour and no 5xx logs on the new deployment.

### Remaining limits and exact next action

- Communications remain disabled. The completed Stripe cutover was not retested and was not changed. Existing unrelated dirty and untracked files, including `.claude/settings.local.json`, `.gitignore`, `CLAUDE.md`, `CODEX.md`, `.ai-control-centre/`, and the four backup files, remain excluded.
- This deployment is ready for the requested homepage marketing work. Preserve the CA$29 Starter and CA$59 Pro prices, the accepted Stripe state, and the contact page. This HANDOFF update is a local documentation commit after the one permitted push; do not push it alone, because that would create an additional deployment. Include it only with the next explicitly approved deployable change.

---

## Latest session (2026-08-05): dedicated Stripe cutover acceptance and cleanup

### Outcome

- The dedicated TradePulse Stripe cutover is accepted within the no-payment, no-communication limits. The canonical live account is TradePulse (`acct_...qa8x`, redacted), and the sole enabled live webhook destination remains `https://www.trytradepulse.com/api/billing/webhook` with the exact six supported events.
- Stripe Workbench manually resent exactly one harmless existing `customer.subscription.deleted` event (`evt_...qFk5`, redacted) to that destination. Stripe marked the delivery `Delivered` and `Recovered` at 2026-08-05 20:02:02 PDT, identified it as manually resent, and recorded HTTP 200 with `{ "received": true }`.
- Vercel recorded exactly one `/api/billing/webhook` request in the 15-minute verification window and no runtime error for that route. Before and after the delivery, dedicated-account counts were unchanged at 50 customers, 3 Checkout Sessions, 100 subscriptions, 100 invoices, 0 PaymentIntents, and 0 charges. The Supabase business count and both billing fingerprints were also unchanged. This is direct evidence that the signed deletion fixture was a hosted no-op.
- No deployment, push, Checkout creation, payment, card entry, email, SMS, or customer communication occurred.

### Portal acceptance

- The active default live TradePulse Portal configuration (`bpc_...I0g5`, redacted) returns to `https://www.trytradepulse.com/profile`. Its business legal URLs are `https://www.trytradepulse.com/privacy` and `https://www.trytradepulse.com/terms`; both returned HTTP 200.
- Payment-method updates, invoice history, and subscription cancellation at period end are enabled. Cancellation proration is disabled. Customer updates, subscription plan changes, quantity changes, promotion codes, pause, cancellation-reason collection, retention discounts, and the Portal login page are disabled.
- One direct hosted Portal session (`bps_...SiTa`, redacted) was opened for the then-existing synthetic customer. It showed TradePulse branding, an exact `Return to TradePulse` link to `/profile`, and only Payment Method and Invoice History sections. The empty synthetic customer had no payment method or invoice history, so those actions could not be exercised without adding prohibited billing data.
- The application Portal route was not exercised. That route requires a stored Stripe customer and subscription; the synthetic business was complimentary with no subscription, and its fallback would preserve POST into Checkout and create a prohibited additional Checkout Session.

### Isolation verification

- In the old `Greg Hansen Studio` account (`acct_...KtuY`, redacted), an exact search for the dedicated synthetic customer id returned `No results`.
- `Parlay Mechanical Website Plan` remains active at CA$199/month. Its existing Payment Link remains active at CA$199/month, and the product price still reports 0 active subscriptions. No old-account or Parlay object was changed.

### Synthetic cleanup

- Preflight tied the shared synthetic customer (`cus_...o8U`, redacted) to `Structured Pricing Test (synthetic, do not send)`, the expected synthetic email, and the expected user metadata. It had exactly the two authorised open unpaid subscription-mode Checkout Sessions, at CA$29 Starter and CA$59 Pro, with the expected configured prices and no subscription, invoice, PaymentIntent, SetupIntent, charge, payment method, default source, or other source.
- Both authorised Checkout Sessions (`cs_live_...Tec5` and `cs_live_...jnqfc`, redacted) were expired. Read-back confirmed both remained unpaid and had no subscription, invoice, PaymentIntent, or SetupIntent.
- A second dependency check found every dependency count still zero, then the shared synthetic customer was deleted and read back as deleted. Dedicated-account customer count changed only from 50 to 49; Checkout Sessions remain as three historical expired records, while subscriptions, invoices, PaymentIntents, and charges were unchanged.
- Supabase cleared `stripe_customer_id` on exactly one conditionally matched `tpe_businesses` row. The same synthetic row remains complimentary Starter with no Stripe customer reference, no subscription reference, and no trial end. Business count remains 29. The billing fingerprint excluding that row remained `40def6aea4abca3bf7e5669f12559f55`, proving unrelated billing references did not change.

### Vercel cleanup and deployment state

- Removed only the five temporary Production variables: `NEW_STRIPE_SECRET_KEY`, `NEW_STRIPE_WEBHOOK_SECRET`, `NEW_STRIPE_PRICE_ID`, `NEW_STRIPE_PRO_PRICE_ID`, and `NEW_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- A name-only API assertion passed: the four canonical Production variables remain present and all five temporary names are absent. No value was printed or copied.
- Production deployment `dpl_...oaRY7` remains READY, Git-sourced from `main` commit `fadebfb`, and still owns `www.trytradepulse.com`, `trytradepulse.com`, and the project aliases. No deployment or rollback was triggered.

### Remaining limits and exact next action

- This acceptance deliberately did not use a real card or create a paid subscription. It did not send every configured event type live. Portal payment-method and invoice-history actions remain unexercised because the synthetic customer was empty, and the application Portal route remains unexercised for the reason above.
- Within those explicit limits, the Stripe account, hosted webhook boundary, Portal configuration, isolation, synthetic cleanup, and temporary-variable cleanup are complete. Do not recreate the synthetic Stripe customer or Checkout Sessions and do not repeat the cutover.
- Exact next action: proceed with the next planned customer approval/contact integration slice on `main`, keeping all communication disabled until that slice explicitly authorises and verifies it.

---

## Latest session (2026-08-05): Starter and Pro pricing update

### Outcome and scope

- TradePulse Starter is now **CA$29/month** and Pro is now **CA$59/month** in the application, public site, authenticated billing copy, metadata, structured data, tests, and current product documentation.
- Plan entitlements did not change. Checkout, upgrade, signup, and webhook recognition still use the configured `STRIPE_PRICE_ID` and `STRIPE_PRO_PRICE_ID`; no Stripe price ID is hardcoded, and unknown or ambiguous subscription price configurations still fail closed.
- The Stripe prices and their Production Vercel price IDs were changed outside this code task. This task did not create, edit, archive, or replace a Stripe product or price and did not change a Vercel environment variable.
- The prior synthetic CA$39 Checkout Session is stale. It must be confirmed expired and its empty synthetic customer must be deleted before either new CA$29 or CA$59 Checkout is created.
- No unrelated dirty file was discarded, stashed, reset, overwritten, or included in the pricing work.

### Repository and files changed

- Worktree: `C:\Work\web-apps\tradepulse-estimates`; branch: `main`; starting commit: `4915dff` (`Document dedicated TradePulse Stripe deployment`).
- Application and shared pricing: `app/page.tsx`, `app/opengraph-image.tsx`, `app/trades/page.tsx`, `app/plumbers/page.tsx`, `app/electricians/page.tsx`, `app/components/plan-picker.tsx`, `app/subscribe/page.tsx`, `app/signup/page.tsx`, `app/components/profile-form.tsx`, and `lib/plan-pricing.ts`.
- Tests: `tests/smoke/plan-pricing.spec.ts` and `playwright.unit.config.ts`.
- Documentation: `PROJECT.md`, `CODEX.md`, `CLAUDE.md`, `DECISIONS.md`, `TRADEPULSE_ESTIMATES_ROADMAP.md`, and `HANDOFF.md`.

### Verification performed before commit

- Focused pricing regression: the shared Starter and Pro prices render as `$29/month` and `$59/month`, and their CTA paths remain `/api/billing/checkout?plan=starter` and `/api/billing/checkout?plan=pro`.
- Complete safe unit suite: 112 passed with the final CTA-path assertions.
- `npx.cmd tsc --noEmit`: passed.
- Targeted ESLint on changed TypeScript files: unchanged existing baseline within that set, 1 error and 6 warnings. No pricing module or pricing test finding.
- `npx.cmd eslint .`: unchanged repository baseline, 7 errors and 18 warnings.
- `npx.cmd next build`: the final source passed. One sandboxed attempt could not fetch DM Sans from Google Fonts; the required network-enabled rerun passed with three existing `metadataBase` warnings.
- Local production-mode browser verification passed at 390 by 844 and 1440 by 900 for homepage Starter/Pro pricing, the Starter-default subscription picker, Pro selection changing the CTA to `$59/month`, Pro signup copy, and no horizontal overflow. There were no page exceptions. Local-only console noise was limited to blocked external telemetry, unauthenticated `/api/profile` 401 responses, and the expected missing local Vercel Insights script; these were not treated as pricing failures.

### Remaining Stripe cutover acceptance work

After the pricing commit is pushed and exactly one READY Production deployment is confirmed: verify the old synthetic CA$39 Checkout is expired, delete its empty customer, and clear only that synthetic database customer reference after deletion succeeds. Then create exactly one unpaid Starter Checkout at CA$29/month and one unpaid Pro Checkout at CA$59/month, inspect both without entering a card or completing payment, and recheck dedicated-account, old-account, and Parlay isolation. The earlier cutover still also requires a real Stripe-signed hosted webhook delivery and a configured, verified TradePulse Billing Portal. Do not send email or SMS, migrate historical customers, mutate Parlay, or remove retained rollback credentials as part of pricing verification.

---

## Latest session (2026-08-03): dedicated Stripe production deployment, PARTIAL CUTOVER

### Outcome

The current `main` branch was pushed and deployed exactly once through the Vercel Git integration. Production deployment `dpl_...QFuy` is READY, serves all five project aliases including `trytradepulse.com` and `www.trytradepulse.com`, and is verified as Git-sourced from `main` commit `f6c8cb1`. The public application, login, authenticated subscription gate, dedicated Starter Checkout, invalid-signature webhook boundary, account isolation, and rollback availability all passed.

The cutover is not a full acceptance pass yet. A real Stripe-signed hosted webhook delivery could not be produced because Stripe Workbench was not authenticated in the available browser and Chrome control was unavailable. The dedicated account also has no active Billing Portal configuration. No Portal session was created because the synthetic customer has no subscription, and the application route would preserve POST into Checkout and create a prohibited second Checkout Session.

No real card was entered, no payment was completed, no email or SMS was sent, no historical customer or subscription was migrated, and no old-account or Parlay object was mutated.

### Repository and deployment

- Starting branch and commit: `main` at `f6c8cb1`; `e3a8eac` was present; all webhook task files were clean.
- The push advanced only `origin/main` from `9c6ff79` through `f43e48c`, `e3a8eac`, and `f6c8cb1`. The pre-existing settings, `.gitignore`, AI Control Centre files, and backups were excluded.
- Previous READY production deployment: `dpl_...kBnj` at `tradepulse-estimates-2lz3gvyqb-gchansen-2620s-projects.vercel.app`.
- Exact Instant Rollback action: `vercel rollback https://tradepulse-estimates-2lz3gvyqb-gchansen-2620s-projects.vercel.app`.
- New READY production deployment: `dpl_...QFuy`, Git-sourced from `main` commit `f6c8cb1`.
- Rollback was not used and remains available. No old Stripe credential was deleted or invalidated.

### Vercel configuration metadata

- Production has all four canonical server-side variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and `STRIPE_PRO_PRICE_ID`. Values were not read.
- All five `NEW_` Production variables remain present and sensitive. They were not removed or changed.
- The application does not read a Stripe publishable key, so no canonical publishable-key variable was changed.
- This task made no Vercel environment-variable mutation. Metadata observed after the operator's manual installation shows no Stripe variables in Preview and only `STRIPE_SECRET_KEY` in Development, which differs from the older audit's broader scopes and must not be described as unchanged historical state.

### Hosted application and Checkout

- `https://trytradepulse.com` returned HTTP 200 and redirected canonically to `https://www.trytradepulse.com/`.
- Homepage and login rendered without browser page or console errors. Unauthenticated `/subscribe` redirected to `/login?next=%2Fsubscribe`.
- Public pricing rendered Starter at CA$39/month and Pro at CA$69/month.
- The synthetic complimentary Starter user signed in through the real login route. `/subscribe` correctly showed complimentary access with no billing action.
- Exactly one authenticated Starter Checkout was requested. Dedicated Stripe read-back confirmed one open, unpaid subscription-mode session, one line item at CA$39/month CAD, product `TradePulse Starter`, success URL `https://www.trytradepulse.com/new?subscribed=1`, cancel URL `https://www.trytradepulse.com/subscribe`, and the intended synthetic user/customer metadata.
- The hosted Stripe page showed TradePulse Starter and CA$39/month. No card data was entered and Checkout was not completed.
- The dedicated account now has exactly one synthetic customer, one open unpaid synthetic Checkout Session, and zero synthetic subscriptions. The connector did not expose an operation to expire the session or delete the empty customer, so both remain for deliberate cleanup. The session will otherwise expire under Stripe's normal lifecycle.
- The synthetic Supabase business remains `plan = starter`, `subscription_status = complimentary`, with a dedicated customer reference and no subscription reference. Its test password was rotated to an unpersisted random value solely for the hosted sign-in.

### Webhook and Portal

- Dedicated Stripe account identity was verified as TradePulse. It has active CA$39/month Starter and CA$69/month Pro prices.
- The enabled destination is exactly `https://trytradepulse.com/api/billing/webhook` with exactly: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, and `invoice.payment_failed`.
- Hosted missing signature returned HTTP 400 `No signature`; hosted invalid signature returned HTTP 400 `Webhook signature verification failed`.
- The 28 signed-fixture tests passed for valid signature acceptance, the exact six-event contract, unknown events, unknown prices, unknown statuses, duplicate delivery, stale events, and zero-row Checkout protection.
- Not verified live: a Stripe-signed hosted delivery and hosted delivery of each configured event type. Workbench authentication is required to close this gap without exposing the webhook secret.
- The dedicated account returned zero active Billing Portal configurations. No Portal session was created. Portal branding, return URL, payment-method update, and invoice-history behaviour remain unverified and Portal launch readiness currently fails.

### Isolation and runtime evidence

- Read-only old-account checks after Checkout found zero synthetic customers, zero synthetic Checkout Sessions, and zero synthetic subscriptions, with no customer, Checkout Session, or subscription of any kind created there during this task.
- Greg Hansen Studio's Parlay Mechanical Website Plan remains active at CA$199/month with the existing active Payment Link. The old account currently has no Parlay subscription object to alter.
- The runtime-created Starter session exists only in the dedicated TradePulse account. This proves the deployed Checkout route is using the dedicated secret and dedicated Starter price rather than the old account.
- The new deployment had no 5xx logs, no Stripe account-mismatch logs, and no billing-route runtime error groups after hosted verification. One unrelated historical/current `/api/generate-estimate` foreign-key error group remains outside this Stripe task.
- No customer communication was sent and no real payment occurred.

### Verification performed

- `git status --short`, `git diff --check`, branch/log checks, exact push-range review, and secret scan.
- Focused webhook suite: 28 passed.
- Safe unit suite: 111 passed.
- `npx.cmd tsc --noEmit`: passed.
- `npm.cmd run lint`: unchanged pre-existing baseline of 7 errors and 18 warnings.
- `npm.cmd run build`: passed; three existing `metadataBase` warnings only.
- Vercel metadata-only variable checks, previous/new deployment inspection, Git-source verification, alias verification, and runtime log/error checks.
- Hosted homepage, login, subscription gate, public pricing, browser console/page errors, synthetic sign-in, one Checkout, dedicated Stripe API read-back, webhook rejection probes, and old-account/Parlay isolation.
- Repository secret scan found only the deliberate `whsec_..._test_only` fixture, with no live Stripe key or webhook-secret literal in deployable source.
- Temporary verifier scripts and automated browser sessions were removed. The `NEW_` Vercel variables were intentionally retained.

### Remaining risks and exact next action

Authenticate to the dedicated TradePulse Stripe Workbench, send a harmless signed test event to the configured destination, and confirm the hosted response and delivery log. Configure and activate the default TradePulse Billing Portal with payment-method update and invoice history, then use only the synthetic customer to verify a Portal session and the exact return URL without adding a card or cancelling anything. Expire the open synthetic Checkout Session and remove the empty synthetic customer, clearing its database customer reference only after Stripe deletion succeeds. Recheck old-account and Parlay isolation, then remove the unused `NEW_` Production variables if their secure source is retained. Do not create another Checkout Session and do not redeploy unless a code change is actually required.

---

## Latest session (2026-08-03): dedicated Stripe production cutover, SENSITIVE-VARIABLE GATE STOP

### Outcome

The coordinated production cutover stopped before any Vercel environment mutation or deployment. Vercel lists all five required `NEW_` Production variables, but every one is stored as type `sensitive`. Vercel sensitive values are non-readable after creation and unavailable to `vercel env run`; a redacted one-shot check confirmed none of the five was injected. Their values therefore could not be validated against Stripe or copied atomically into the canonical names.

No Stripe account, product, price, customer, subscription, Checkout session, webhook, Portal session, Supabase row, Vercel variable, deployment, email, SMS, payment, or Parlay configuration was created, changed, or removed. Nothing was pushed.

### Repository and Vercel audit

- Branch and starting commit: `main` at `e3a8eac`; all webhook task files were clean.
- Production code reads exactly `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and `STRIPE_PRO_PRICE_ID`.
- Production code does not read `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` or `STRIPE_PORTAL_CONFIGURATION_ID`.
- No committed live Stripe secret, full live Stripe object id, hard-coded product or price id, portal configuration id, account id, or active old webhook alias was found.
- Canonical route and contract remain `POST https://trytradepulse.com/api/billing/webhook` with the exact six events in `TRADEPULSE_STRIPE_WEBHOOK.md`.
- Vercel linkage is `gchansen-2620s-projects/tradepulse-estimates`. The current Production deployment is READY at `dpl_...BfAL` and remains the active rollback deployment.
- All four canonical Stripe Production variables exist. The canonical secret key is also Vercel-sensitive and was updated after the local `.env.local` file, so its old value cannot be proven recoverable from local state.

### Decision-gate blocker and rollback state

The brief requires read-only validation that all five temporary values belong to one dedicated TradePulse live account, exact Starter and Pro price validation, webhook-secret ownership validation, and a rollback plan that restores every canonical variable together. None can be guaranteed while the temporary values and current canonical secret are non-readable. Proceeding would risk mixing Stripe accounts and would make canonical-variable rollback incomplete. The existing Production variables and deployment were left untouched, so the pre-cutover application remains the rollback baseline.

### Verification performed

- `git branch --show-current`: `main`.
- `git status --short`: only the pre-existing unrelated dirty-file set before this handoff update.
- `git log -10 --oneline`: `e3a8eac` present at HEAD.
- Webhook task file status: clean.
- Complete Stripe environment, object-id, API-version, route, Checkout, Portal, upgrade, signup, OAuth provisioning, subscribe-page, and access-gating audit.
- Read-only `vercel whoami`, project inspection, Production environment metadata listing, deployment listing, and deployment inspection.
- Focused signed-fixture webhook suite: 28 passed.
- Full safe unit suite: 111 passed.
- `npx.cmd tsc --noEmit`: passed.
- `npx.cmd eslint .`: unchanged pre-existing baseline of 7 errors and 18 warnings.
- `npx.cmd next build`: passed after allowing the existing DM Sans fetch; three existing `metadataBase` warnings only.
- `git diff --check`: passed before this documentation update.
- Tracked-file live-secret and full Stripe object-id scans: no matches.
- Old webhook alias search: historical references only in this handoff, no application route.

### Not verified

Dedicated Stripe account identity, public business details, Starter and Pro prices, publishable key, webhook secret ownership, live destination state, Portal configuration, hosted post-cutover behaviour, synthetic Checkout creation, deployed signed webhook delivery, Portal session creation, and old-account isolation were not verified because the mandatory temporary-value and rollback gates failed first.

### Exact next action

From the original secure sources, recreate the five `NEW_` values directly in Vercel as Production-only encrypted variables that can be read for this one cutover, without putting any value in chat or Git. Retain the existing sensitive variables until the replacements are confirmed. Also retain a secure recoverable copy of the complete current canonical Stripe set. Then rerun this coordinated cutover from the repository audit; remove the readable temporary values immediately after the verified deployment.

---

## Latest session (2026-08-03): Stripe webhook compatibility repair

### Outcome

Recovered the five interrupted webhook files and completed the narrow compatibility repair on `main`. The sole canonical route is `POST /api/billing/webhook`, with production destination `https://trytradepulse.com/api/billing/webhook`. No compatibility alias was added. No Stripe Dashboard, Stripe object, Vercel environment, deployment, Supabase production row, Checkout session, email, SMS, or Parlay configuration was changed.

### Exact supported event list

1. `checkout.session.completed`
2. `customer.subscription.created`
3. `customer.subscription.updated`
4. `customer.subscription.deleted`
5. `invoice.payment_succeeded`
6. `invoice.payment_failed`

### Webhook behaviour and safeguards

- Raw request text is verified with `stripe-signature` and the required server-only `STRIPE_WEBHOOK_SECRET` before dispatch.
- Checkout validates owner metadata, the Stripe customer/subscription relationship, and exactly one configured Starter or Pro price. The derived plan must match metadata.
- The conditional Checkout update returns the matched business row. A zero-row result is acknowledged without mutation and cannot inspect, cancel, or overwrite the previous trial.
- A previous trial is cancelled only when its Stripe customer also matches. Transient cancellation failures return HTTP 500, and duplicate Checkout delivery retries the cancellation after the idempotent link.
- Subscription creation and update share one path and refuse unknown, missing, or multiple prices without overwriting plan or status.
- Stripe status mapping is explicit: `active` to `active`; `trialing` to `trial`; `past_due`, `unpaid`, `incomplete`, and `paused` to `past_due`; `incomplete_expired` and `canceled` to `cancelled`. Unknown values cause no mutation.
- Subscription deletion and invoice state changes require the matching current customer and subscription. Positive paid invoices restore `active` only when the retrieved Stripe subscription is also active. Terminal or unknown subscriptions cannot be reactivated or overwritten by late invoice events. Duplicate deliveries remain idempotent state assignments.
- Unknown signed events and validation refusals return HTTP 200 without database mutation. Transient processing errors return HTTP 500 for retry. Customer responses never include raw Stripe or database errors.

### Files changed

- `app/api/billing/webhook/route.ts`
- `lib/stripe-webhook.ts`
- `tests/smoke/stripe-webhook.spec.ts`
- `playwright.unit.config.ts`
- `TRADEPULSE_STRIPE_WEBHOOK.md`
- `HANDOFF.md`

### Verification performed

- Focused signed-fixture webhook suite: 28 passed.
- Full safe unit suite through `playwright.unit.config.ts`: 111 passed.
- `npx.cmd tsc --noEmit`: passed.
- Intended webhook/config ESLint check: passed.
- Full `npx.cmd eslint .`: unchanged pre-existing baseline of 7 errors and 18 warnings; no intended-file findings.
- `npx.cmd next build`: passed after allowing the existing DM Sans fetch; the only output warnings were the three existing `metadataBase` warnings. The build exposed one Stripe webhook route at `/api/billing/webhook` and no compatibility alias.
- Repository route, supported-event, secret, Stripe object-id, and mutation searches: one Stripe webhook implementation, one code event-list constant, no committed real secret or full Stripe object id, and no Vercel or Stripe Dashboard mutation code added.
- `git diff --check`: passed.

### Final review

- Standards review found no documented-standard violations. Its two judgement-call findings were resolved by centralising subscription price extraction and typing the subscription update payload.
- Specification review found and verified three edge cases: previous-trial customer validation, retryable previous-trial cancellation, and prevention of late paid-invoice reactivation for terminal or unknown subscriptions. All three now have focused regressions.

### Dashboard and cutover state

The dedicated TradePulse Stripe destination still needs its URL and event selection updated after this code is deployed. The coordinated Vercel and Stripe production cutover has not been performed.

### Exact next action

Update the dedicated TradePulse Stripe webhook destination to `https://trytradepulse.com/api/billing/webhook` with the six verified events, then rerun the coordinated production Stripe cutover from the repository audit.

---

## Latest session (2026-08-02): dedicated Stripe production cutover, COMPATIBILITY GATE STOP

### Outcome

The worktree was safely returned to `main` at `9c6ff79` with the same dirty-file set preserved. The controlled production cutover then stopped at the required repository compatibility gate. No Vercel environment variable, Stripe object, Supabase row, deployment, customer, subscription, Checkout session, Portal session, payment, email, or SMS was created or changed. Nothing was pushed.

### Verified incompatibilities

- The dedicated TradePulse Stripe webhook is configured for `https://trytradepulse.com/api/webhooks/stripe`, but the application exposes only `POST /api/billing/webhook`.
- The dedicated webhook's exact event set includes `invoice.payment_failed`, but `app/api/billing/webhook/route.ts` does not handle that event.
- The application handles `customer.subscription.created`, but that event is absent from the dedicated webhook's exact event set.
- The compatible events are `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_succeeded`.
- The webhook route correctly reads the raw request body and verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET`; invalid or missing signatures return HTTP 400, and unknown signed events return HTTP 200 without entering a mutation branch.

### Repository Stripe environment contract

- Application runtime reads: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and `STRIPE_PRO_PRICE_ID`.
- Application runtime does not read: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` or `STRIPE_PORTAL_CONFIGURATION_ID`.
- No hard-coded `price_`, `prod_`, `acct_`, or `bpc_` object id was found in tracked application code.
- Stripe API version is pinned centrally in `lib/stripe.ts` to `2026-03-25.dahlia`; the smoke-test helper uses the same version.
- Portal sessions rely on Stripe's default portal configuration. No portal configuration id is passed by the application.

### Cutover and rollback state

The five temporary Production variables were not read or validated because the compatibility gate failed first. The canonical Production variables and temporary variables remain unchanged. No deployment was triggered, so the pre-cutover production deployment and environment configuration remain the rollback baseline.

### Verification performed

Read-only branch, status, handoff-diff, and commit comparison; safe switch to `main`; post-switch branch/commit/status/diff confirmation; complete tracked-code searches for Stripe environment references, object ids, webhook URLs, portal configuration ids, and API-version pins; direct review of Stripe initialisation, Checkout, upgrade, Portal, signup, OAuth provisioning, subscription page, and webhook route logic. Automated tests, build, hosted checks, temporary-value validation, Stripe account reads, Vercel mutations, Checkout verification, webhook delivery tests, Portal verification, and old-account isolation checks were not run because the prompt requires an immediate stop on an incomplete or incompatible webhook contract.

### Exact next action

Decide and implement one coherent webhook contract before restarting the cutover: either add a deployed `POST /api/webhooks/stripe` route that safely handles `invoice.payment_failed` and determine whether `customer.subscription.created` is still required, or reconfigure the dedicated Stripe endpoint to the existing route and the complete event set the application requires. Then run focused webhook tests and restart the cutover from the repository audit.

---

## Latest session (2026-08-02): Stripe portal branding audit, DECISION GATE STOP

### Outcome

The live Stripe account used by TradePulse is **shared**, so no account-wide branding, public-business details, portal configuration, Stripe objects, environment variables, or application billing code were changed. The account id is `acct_...KtuY` (redacted). This task stopped at the explicit shared-account decision gate. No commit was created and nothing was pushed.

### Read-only evidence

- Current live account identity: public business name and Dashboard display name `Greg Hansen Studio`; website `https://greghansen.ca`; support email and support URL unset; icon and logo unset; primary colour `#142c2d`; secondary colour `#e05a31`.
- The account has two active products: `TradePulse Estimates`, with active CA$39/month Starter and CA$69/month Pro prices, and `Parlay Mechanical Website Plan`, with an active CA$199/month price.
- The account has one active Payment Link, and its line items reference `Parlay Mechanical Website Plan`. This is direct evidence that globally renaming or rebranding the account would alter another business's customer-facing payment surface.
- All 84 non-deleted Stripe customers have TradePulse `user_id` metadata. All 686 subscriptions reference `TradePulse Estimates`: 645 cancelled, 33 past due, and 8 trialling. The TradePulse database currently has 29 businesses, 25 Stripe customer references, and 25 Stripe subscription references. The historical Stripe population must be reconciled before migration rather than copied blindly.
- All 33 live past-due subscriptions match the observed recovery state: ended trial, configured CA$39 Starter price, open CA$39 invoice, and no attached card. Stripe documents this as the expected `past_due` result when a trial ends with `missing_payment_method=create_invoice` and the invoice cannot be paid.
- The only live portal configuration is the active account default (`bpc_...CAXV`, redacted). It has no headline and no default return URL. Payment-method updates and invoice history are enabled. Subscription cancellation is disabled. The application does not pass a configuration id or locale and overrides the return URL to `{origin}/profile`.
- The live webhook endpoint is `https://www.trytradepulse.com/api/billing/webhook`, enabled for the five required events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_succeeded`.
- Test-mode branding and portal parity were not verified. No test secret key is configured locally, and the available browser reached Stripe sign-in rather than an authenticated Dashboard session.

### Application findings

- `POST /api/billing/portal` authenticates with Supabase `getUser()`, derives the business by `owner_user_id`, and uses that business's stored Stripe customer and subscription ids. It currently relies on Stripe's ambiguous default portal configuration.
- The portal route derives its return origin from the request `Origin` header before `NEXT_PUBLIC_APP_URL`, then returns to `/profile`. A dedicated-account implementation should use a canonical TradePulse origin and an explicit portal configuration id.
- Portal failures currently redirect with POST preservation to Checkout. That avoids a dead end but can send an existing billing-recovery user into a new-subscription flow. The dedicated-account implementation should instead show a safe billing error and support path.
- `/subscribe` correctly distinguishes the observed `past_due` state and does not imply a successful charge. Its warning card is static, while the real portal action is a low-contrast text button below it, so `Update payment method` is not currently the obvious primary action.
- Access gating is consistent for active, complimentary, and unexpired-trial users. Past-due, cancelled, incomplete, and expired-trial users are denied app access and routed to `/subscribe`. A successful positive-value `invoice.payment_succeeded` sets the application status back to `active`. No payment, cancellation, email, or customer communication was performed.

### Existing TradePulse assets

- `public/favicon.png` is the correct square TradePulse icon but only 32x32. Stripe requires account branding images to be at least 128x128, so it must not be uploaded as-is.
- `public/tradepulse-logo.png` is the correct existing TradePulse wordmark but is 300x94, below Stripe's minimum height. A higher-resolution export of the same approved artwork is required. Do not invent or redraw the brand.
- The application's established brand colours are navy `#0D1B2E` and amber `#f59e0b`. These differ from the shared account's current colours and should be applied only to a dedicated TradePulse account.

### Safest dedicated-account migration plan

1. Obtain explicit approval, then create and activate a dedicated TradePulse Stripe account. Do not alter the current shared account.
2. Configure the dedicated account's public name, website, support URL, support email, approved high-resolution icon/logo, and existing navy/amber colours in both live and sandbox settings.
3. Recreate the TradePulse Estimates product and CA$39/month Starter and CA$69/month Pro prices. Price ids are account-scoped and must change in application configuration.
4. Create a dedicated TradePulse portal configuration with a TradePulse headline, canonical return URL, payment-method updates, invoice history, and cancellation at period end if the existing product rule is retained. Pin its id in application sessions through a server-only environment variable.
5. Create a new webhook endpoint for the same five required events, store the new signing secret, and verify event delivery before cutover.
6. Ask Stripe to copy only the reconciled TradePulse customer and supported payment-method data. Stripe can copy customers and supported payment methods, but not subscriptions, invoices, products, prices, charges, coupons, events, or logs. Payment-method ids change; copied customer ids can remain the same.
7. Recreate eligible live subscriptions in the dedicated account with an explicit cutover plan for billing-cycle anchors, trials, outstanding invoices, and duplicate-charge prevention. Update each TradePulse business row only after its new customer/subscription pairing is verified. Cancel old subscriptions only after the replacement is confirmed.
8. Update `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, and a new `STRIPE_PORTAL_CONFIGURATION_ID`; then implement the explicit portal configuration, canonical return URL, safe portal-error path, primary `/subscribe` recovery button, and focused mocked tests requested by this task.
9. Deploy to a safe target, verify sandbox first, then perform a controlled live cutover and reconcile Stripe against the 25 database-referenced customers/subscriptions. Keep the shared account for Parlay and historical records.

### Verification performed

Read-only Stripe API audit of account details, branding, all products/prices, Payment Link line items, aggregate customers, all subscriptions, portal configurations, recovery-state invoices/payment methods, and webhook endpoints; read-only Supabase aggregate comparison; repository code review of Stripe creation, Checkout, Portal, `/subscribe`, webhook, auth, and proxy logic; official Stripe documentation review; existing brand asset inspection; initial and final repository status checks. No automated suite, typecheck, lint, or build was run because the decision gate prohibited implementation and the only intended repository change is this handoff record.

### Exact next action

Decide whether to create a dedicated TradePulse Stripe account and authorize a controlled migration. If approved, first obtain high-resolution exports of the existing TradePulse icon and wordmark, create and configure the dedicated account in sandbox and live modes, and produce a reconciled migration manifest for the 25 database-referenced customer/subscription pairs before changing code or production environment variables.

---

## Latest session (2026-08-02): grouped-versus-detailed customer pricing, VERIFIED PASS

### Implementation

New structured drafts now show a compact `Customer pricing` control on the contractor estimate page when the exact server-side flag `ESTIMATE_GROUPED_PRICING_INTERNAL=true` is present. Detailed remains the database and UI default. The control is absent for markdown estimates, missing structured rows, non-draft or customer-visible estimates, anonymous users, and public share visitors. Protected state means any non-draft status, or any non-null `sent_at`, `copied_at`, `completed_at`, `payment_status`, `invoice_amount`, or `review_requested_at`.

`PATCH /api/estimates/[id]/pricing-mode` authenticates with `getUser()`, derives the contractor's business server-side, scopes the estimate to that business, validates the closed `detailed | grouped` value, confirms structured rows and totals, and uses the service role only after ownership is established. Its atomic update writes only `customer_pricing_mode` and repeats every protected-state predicate at write time. Same-mode saves are safe no-ops.

`lib/estimate-pricing-mode.ts` and `lib/estimate-pricing-server.ts` provide one shared server-built customer summary. The contractor preview, share page, and client-side PDF all receive that same summary. Detailed output reconstructs the current item descriptions, order, and values from structured rows while retaining markdown prose. Grouped output combines visible rows by first group appearance, uses `Additional items` for null groups, and exposes no item prices or internal fields. Any missing rows, invalid mode, disabled grouped flag, or subtotal disagreement fails closed to the existing detailed markdown. Raw database errors are logged only on the server. Structured line-item fields are read-only in the existing detailed editor so edits cannot create a second writable pricing source; prose remains editable.

### Files

Added: `app/api/estimates/[id]/pricing-mode/route.ts`, `app/components/estimate-pricing-editor.tsx`, `lib/estimate-pricing-mode.ts`, `lib/estimate-pricing-server.ts`, `playwright.unit.config.ts`, `tests/smoke/estimate-pricing-mode.spec.ts`.

Modified: `app/components/download-pdf-button.tsx`, `app/components/editable-estimate-body.tsx`, `app/estimates/[id]/page.tsx`, `app/share/[id]/page.tsx`, `lib/estimate-groups.ts`, `lib/estimate-item-migration.ts`, `lib/estimate-summary.ts`, `lib/generate-pdf.ts`, `package.json`, `TRADEPULSE_ESTIMATES_BASELINE.md`, `TRADEPULSE_ESTIMATES_ROADMAP.md`, and this file. `lib/database.types.ts`, schema, migrations, environment files, RLS, generation prompts, billing, approval, invoices, payments, reviews, and follow-ups were not changed.

### Controlled production-backed verification

The existing synthetic structured estimate was safely identified without putting its raw id in any committed file. A local dev server alone received `ESTIMATE_GROUPED_PRICING_INTERNAL=true`; `.env.local` and production configuration were unchanged. The real authenticated contractor page switched Detailed to Grouped, persisted successfully, and showed `Additional items` $252.50 plus `Plumbing` $230. The public share page showed the same two rows and no toggle. The generated two-page A4 PDF was inspected as extracted text and as rendered PNG pages; it showed the same grouped rows, subtotal $482.50, GST $24, total $506.50, no deposit, and balance $506.50, with no individual item prices or internal fields. The estimate was then restored to Detailed, and both contractor and share views returned to the original four rows in the original order.

Final read-only production audit: 30 estimates total, 29 markdown and 1 structured; all 30 have `customer_pricing_mode = detailed`; 4 structured item rows belong to the single synthetic draft; that draft remains `status = draft` with every protected field null. No historical estimate was converted or updated. No SMS, email, copy-link delivery stamp, job completion, invoice, payment, review request, reminder, or other customer communication was triggered.

Indicative local dev timings from Next's request log: contractor detail 3.4s cold and 0.85s to 1.16s warm; share page 3.5s cold and 0.51s to 1.07s warm; pricing-mode PATCH 2.9s cold and 0.74s warm. The PDF was created and visually inspected, but its exact client generation time was not captured because the browser runtime did not surface the download event even though the file appeared on disk. These are observations, not benchmarks.

### Verification

- `npm.cmd run test:unit`: 83 passed, using the safe unit-only Playwright configuration with no global setup.
- `npx.cmd tsc --noEmit`: passed.
- `npx.cmd next build`: passed after rerunning with network access so the existing DM Sans font could be fetched. Existing `metadataBase` warnings remain.
- `npx.cmd eslint .`: the unchanged pre-existing baseline remains, 7 errors and 18 warnings. No grouped-pricing file introduced a lint finding.
- Browser: contractor Detailed and Grouped, share Detailed and Grouped, mobile layout, persistence in both directions, PDF text and page rendering, and console warnings/errors checked. No browser console warning or error was found on the verified contractor or share pages.
- Final repository checks: `git diff --check`, full changed-file review, protected-flow searches, staged secret/customer-id scan, exact staged-file review, and final git status.

### Remaining risks and limitations

- Production grouped pricing remains disabled until the exact internal flag is deliberately enabled in deployment configuration.
- Historical markdown estimates remain markdown-authoritative and have no toggle. The lazy conversion slice remains deliberately unshipped.
- Group assignment remains keyword-based. An unrecognised item is honestly shown under `Additional items` rather than guessed.
- Structured pricing rows are read-only in the current editor. A future structured line-item editing slice would need an atomic row-update path that preserves all cross-surface totals.
- The PDF page break can place the final Pricing Summary rows on page 2. The content is complete and readable, but pagination was not redesigned in this slice.
- The slice-1 RLS policy decision and deliberate synthetic-account cleanup decision remain open.

### Exact next action

Implement customer approval and change requests backed by immutable estimate snapshots. Define the snapshot and state-transition contract before adding approval controls, so a customer decision always refers to an unchangeable priced estimate.

---

## Latest session (2026-07-31, latest): checkpoint commit + one controlled end-to-end generation, VERIFIED PASS

### Checkpoint commit

**`2bbe646` "Add structured pricing for new estimates"**, on `main`, **not pushed**. 7 files, 631 insertions: `app/api/generate-estimate/route.ts`, `lib/estimate-item-migration.ts`, `lib/estimate-groups.ts`, both spec files, and the two doc updates. The same 7 pre-existing unrelated files stayed excluded (`.claude/settings.local.json`, `.gitignore`, `.ai-control-centre/`, four `.bak` files). Reviewed the full diff, confirmed no secrets/UUIDs/real emails in the staged content, then ran `git diff --check`, `npx tsc --noEmit`, 212 grouped-pricing and conversion assertions, `npx next build`, and `npx eslint` before committing. All green; lint identical to the pre-existing baseline.

### Controlled end-to-end generation: VERIFIED PASS

The generation route with structured-item wiring had never been exercised end to end. This session ran it once, for real, against production.

**How the account was created.** The real signup route creates a Stripe customer and trial subscription, which this task's constraints forbid touching. Instead I created a synthetic auth user directly via the Supabase admin API and inserted a matching `tpe_businesses` row by hand (`subscription_status = 'complimentary'`, no Stripe object of any kind), then signed in through the real `/login` page to get a genuine session. This is the same shape of account provisioning the existing Playwright suite uses, minus the Stripe leg.

**What ran:** the real `/new` page, filled with the exact job description and synthetic customer data specified, submitted through the real `POST /api/generate-estimate` route (a real Anthropic call, a real database insert, and the real `convertEstimateToStructuredItems` call this session's earlier work wired in). Total round trip: **6.8 seconds** (`application-code: 6.7s` per the dev server's own timing log), which bundles generation, the DB insert, and the structured conversion together; the conversion step alone was not separately measurable without adding timing code, which was out of scope.

**Result.**

| Check | Markdown (independently recomputed) | Structured (database) |
|---|---|---|
| Line item / row count | 4 | 4 |
| Subtotal | $482.50 | $482.50 |
| Tax (5%) | $24 | $24 |
| Total | $506.50 | $506.50 |
| Deposit | $0 | $0 |

`pricing_source = 'structured'`, `customer_pricing_mode = 'detailed'`, no duplicate rows. 2 of the 4 rows were correctly assigned to "Plumbing" (the faucet and the shutoff valve); the bare "Labour" row and "Teflon tape and fittings" were correctly left ungrouped, since neither matches a keyword rule and forcing a bucket would have been worse than leaving them out.

**Detailed rendering verified unchanged**, against the actual server-rendered HTML fetched directly (the browser pane in this environment does not composite frames, so I read the raw response rather than relying on a visual render, and cross-checked with the dev server's own successful `200` logs for the same route): the contractor estimate page and the public share page both show the same title, the same four line items in the same order at the same prices, the same subtotal, and **zero** occurrences of any grouped-pricing term or structured-storage field name in either page's output. The PDF download control was clicked and produced no console error; since `lib/generate-pdf.ts` was not touched by this or the prior slice and reads the same unchanged markdown, its output cannot have regressed.

**The internal grouped renderer, run against this real estimate's actual 4 structured rows** (not a fixture): grouped subtotal $482.50, exactly matching the detailed subtotal, with every row landing in exactly one group ("Additional items" $252.50 for the two ungrouped rows, "Plumbing" $230 for the other two). The flag was not turned on anywhere, and a repository search found no customer route referencing the grouped renderer.

**No customer communication was sent.** The estimate was never marked sent, done, or invoiced, and no review request was triggered.

**Production counts, before and after:**

| | Before | After |
|---|---|---|
| `tpe_estimates` | 29 | 30 (the one authorized test estimate) |
| `tpe_estimate_items` | 0 | 4 (only the test estimate's rows) |
| `pricing_source = 'markdown'` | 29 | 29 (every pre-existing estimate, unchanged) |
| `pricing_source = 'structured'` | 0 | 1 (only the test estimate) |

### Test estimate disposition: remains in the database

Per this task's own rule, deletion was only authorized "if there is an existing safe admin cleanup path and deletion is clearly reversible and verified." A hard delete of a database row is never reversible in that sense, so the estimate was left in place rather than deleted. Its `business_id` foreign key has no cascade, so the synthetic business (and therefore the synthetic auth user) cannot be removed without first removing the estimate either, and so those remain too.

All three are unambiguously synthetic and inert: the business is named "Structured Pricing Test (synthetic, do not send)", the estimate is a `draft` that was never sent to anyone, uses the synthetic contact details specified in this task, and is not linked from anywhere a real customer would see. The estimate's raw id is intentionally not recorded in any committed file. **Recommendation:** treat cleanup of this synthetic account as a deliberate, separate, explicitly authorized action, the same way this project has handled other test-account cleanup in the past, rather than something to do inline in a verification task.

### Performance observations

Generation-plus-conversion round trip: 6.8s total, 6.7s application code, per the dev server's own request timer. Not separated into a generation-only and conversion-only figure, since doing that would need new timing instrumentation, which was out of scope. No timeout, no runtime warning, and no visibly delayed streaming completion (Anthropic streams a large majority of that time regardless of this feature). Treat this as one indicative data point, not a benchmark, since the surrounding dev environment is not a controlled performance harness.

### Remaining risks

- **Only one generation was run.** It hit the common, well-formed path. A malformed or multi-option generation reaching this exact wired code has still never been observed live, only reasoned about via the fixture corpus and the rolled-back database tests from the prior session.
- **A synthetic business, user, and estimate now permanently exist in production**, pending a deliberate cleanup decision.
- The classifier is keyword-based and will mislabel or leave ungrouped some real descriptions; this generation's own result (2 of 4 rows ungrouped) illustrates that directly. Presentation only, never a price, and not customer-visible yet.
- Playwright specs remain unexecuted through the runner.
- The slice-1 RLS policy decision is still open.

### Exact next action

**Implement the contractor-facing grouped-versus-detailed pricing toggle for newly generated structured estimates only. Preserve detailed mode as the default. Do not alter, migrate, or reinterpret existing markdown estimates.** This slice is unblocked; the E2E verification passed cleanly. Old and sent markdown estimates must remain untouched and continue to have no toggle. Separately, and not urgently: decide what to do with the synthetic test account left behind by this verification.

---

## Prior session (2026-07-31, earlier): structured generation for new estimates + internal grouped renderer

### Checkpoint commit

**`0ad9605` "Add lazy estimate item conversion service"**, on `main`, **not pushed**. 7 files, 997 insertions: `lib/estimate-item-migration.ts`, the transaction-function migration, its test, the conversion document, the regenerated types, and the two doc updates. The same 7 pre-existing unrelated files stayed excluded (`.claude/settings.local.json`, `.gitignore`, `.ai-control-centre/`, four `.bak` files).

### Grouped-pricing slice: structured generation, detailed rendering unchanged

**Files added:** `lib/estimate-groups.ts`, `tests/smoke/estimate-grouped-pricing.spec.ts`.
**Files modified:** `app/api/generate-estimate/route.ts`, `lib/estimate-item-migration.ts`, `tests/smoke/estimate-item-migration.spec.ts`, `TRADEPULSE_ESTIMATES_BASELINE.md`, `HANDOFF.md`.

**Structured generation.** After a new estimate is saved and its `__ID__` chunk is streamed, the route calls `convertEstimateToStructuredItems({ dryRun: false, assignGroups: true })`. It runs before `controller.close()` so the runtime cannot freeze the instance mid-conversion. It is wrapped in try/catch and is **strictly non-fatal**: any refusal or throw leaves the estimate markdown-authoritative. Applies to newly generated estimates only.

**Group assignment.** 15 ordered keyword rules in `lib/estimate-groups.ts` covering demolition, permits, concrete, framing, roofing, plumbing, electrical, HVAC, drywall, flooring, cabinets, trim, painting, landscaping, and cleanup. Word-anchored with an optional plural, first match wins. **An unrecognised description stays ungrouped rather than being forced into a wrong bucket**; the renderer collects those under "Additional items". Group assignment is opt-in: the lazy path for existing estimates still writes null.

**Rendering.** **No renderer file was touched**, verified by `git diff --stat` over the share page, PDF, markdown component, editor, and estimate page. Detailed output is therefore identical by construction, not by assertion, because the markdown summary is preserved and every renderer still reads it. The grouped renderer is new code behind `isGroupedPricingEnabled()` (env `ESTIMATE_GROUPED_PRICING_INTERNAL`, default off, only the exact string `true` enables it) and nothing customer-facing calls it.

### Tests and verification

- **319 grouped-pricing assertions, 0 failures**: flag gating, all 15 group rules, ungrouped fallback, substring-misfire guards, mapping equivalence with and without groups, grouped-equals-detailed totals across all 31 valid fixtures, no double counting, first-appearance ordering, both renderers, and markdown fallback for unsupported estimates.
- **Database, rolled back**: 4 rows inserted with groups, source flipped, `group_label` round-tripped including a deliberate null, grouped sum equalled the detailed subtotal exactly (1200), 3 distinct groups, order preserved.
- Existing suites still green: conversion invariants 249/0, conversion service 130/0.
- `npx tsc --noEmit` clean; `npx next build` compiled, 52 pages; `npx eslint` **25 problems, 7 errors, 18 warnings, identical to baseline**, 0 in new files; `git diff --check` clean.

**Two real bugs were caught by these tests and fixed:** the classifier failed on plurals ("Pot lights" fell through to ungrouped, because the word boundary fails against a trailing "s"), and one of my own assertions wrongly expected a negative-amount estimate to refuse, when a credit row is legitimately convertible.

### Production state: unchanged

`tpe_estimate_items` **0 rows**; **29** estimates, **all** `pricing_source = 'markdown'` and `customer_pricing_mode = 'detailed'`; **0** structured; fingerprint `152dab94ef40910e348e7867c08e4439` and `max(updated_at)` both unchanged; no fixture leftovers.

### Remaining risks

- **The generation path has not been exercised end to end.** Doing so requires generating a real estimate, which means a real Anthropic call and a real production row. The pieces are individually verified (pure mapping, the database function, the conversion service's checks) but the wired route was never run. **This is the main gap: the first real generation will be the first execution of this path.** It is designed to fail safe, but that design is unproven in flight.
- Conversion adds a few database round trips before the stream closes, so the last moment of generation is slightly slower. Not measured.
- The classifier is keyword-based and will mislabel or leave ungrouped some real descriptions. It affects presentation only, never a price, and grouped output is not customer-visible yet.
- Playwright specs remain unexecuted through the runner.
- The slice-1 RLS decision is still open.

### Exact next action

Exercise the generation path once in a controlled way, then decide on grouped exposure. Concretely: generate one estimate in a non-production-visible manner or accept one real draft, confirm structured rows and groups were written and that the estimate renders identically, then design the contractor-facing grouped toggle. Do not convert the 21 eligible existing estimates without a separate decision.

---

## Prior session (2026-07-31): checkpoint commit + lazy conversion service

### Checkpoint commit

**`6f40ddb` "Add structured estimate pricing foundation"**, on `main`, **not pushed**. 25 files, 5945 insertions: the documentation corrections, baseline and architecture and audit and schema documents, the photo-deletion repair, the `completed_at` fix, Pro Payments server-side enforcement, `lib/estimate-items.ts` with its fixtures and tests, the audit script, the schema migration, and the regenerated types.

**Deliberately excluded and still dirty**, all pre-existing and unrelated: `.claude/settings.local.json` (local permissions), `.gitignore` (an unrelated `*.zip` line), `.ai-control-centre/`, and four `.bak-*` backup files. Every one of those was in the working tree before this work began.

### Conversion slice status: COMPLETE, not wired

**Files added:** `lib/estimate-item-migration.ts`, `supabase/migrations/20260731010000_create_convert_estimate_to_structured_fn.sql`, `tests/smoke/estimate-item-migration.spec.ts`, `TRADEPULSE_ESTIMATE_ITEM_CONVERSION.md`.

**Files modified:** `lib/database.types.ts` (regenerated for the new function), `TRADEPULSE_ESTIMATES_BASELINE.md`, `HANDOFF.md`.

### Transaction design

PostgREST cannot span a transaction across HTTP calls, so the insert and the `pricing_source` flip live in one PL/pgSQL function, `tpe_convert_estimate_to_structured`, which Postgres runs as a single transaction. This follows the project's one existing RPC, `increment_rate_limit`, including the `p_` prefix. The function locks the estimate with `SELECT ... FOR UPDATE`, re-checks ownership and eligibility under the lock, refuses if any structured row exists, inserts only 14 known keys with `estimate_id` taken from the argument rather than the payload, verifies the inserted row count, re-sums `line_total` **from the table** rather than trusting the caller, and only then flips the source. `SECURITY INVOKER` deliberately, with `EXECUTE` revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`.

### Tests and verification

- **Pure unit, executed: 130 assertions, 0 failures.** Multi-option detection, row mapping, the flat-fee rule, the no-inference guarantees, defaults, key whitelist, and mapped-subtotal preservation across all 31 valid fixtures.
- **Transaction, executed against the real function: 9 cases, all correct**, inside a transaction aborted by design with fixtures created and rolled back in the same transaction. Happy path inserted 2 rows and flipped the source; a second call refused `ALREADY_STRUCTURED` with no duplicates; sent estimate refused and untouched; cross-business refused; count mismatch rolled back to 0 rows; **subtotal mismatch after insert rolled the inserted rows back with the source unflipped**, which is the definitive atomicity proof; pre-existing rows refused; empty payload refused; summary unchanged.
- Existing conversion suite: 249 assertions, 0 failures. `npx tsc --noEmit` clean. `npx next build` compiled, 52 static pages. `npx eslint` **25 problems, 7 errors, 18 warnings, identical to the pre-existing baseline**, 0 in new files.
- Repository search: the only importer of the service anywhere is its own test. Nothing in `app/` or `proxy.ts` references it. No client component imports it.

### Production conversion count: ZERO

**Confirmed after all testing:** `tpe_estimate_items` holds **0 rows**, all **29** estimates remain `pricing_source = 'markdown'`, **0** are `structured`, the content fingerprint `152dab94ef40910e348e7867c08e4439` is unchanged, and `max(updated_at)` is still `2026-07-30 15:35:03.258894+00`. Zero businesses and zero estimates were created in the test window; every fixture rolled back.

### Remaining risks

- **The TypeScript service was never executed end to end.** Its pure pieces ran in isolation and its database half ran directly, but `convertEstimateToStructuredItems()` itself was not invoked, since that needs a real authenticated user. Its error mapping and result assembly under a live call are unverified.
- **Ownership was proved at the database layer only.** The cross-business refusal ran inside the function; the TypeScript-layer checks were read, not executed.
- **Anonymous refusal is proved structurally** (revoked `EXECUTE` plus deny-all RLS), not by an executed anonymous call.
- **Concurrency was reasoned about, not raced.** The `FOR UPDATE` lock is the right mechanism but two simultaneous conversions were not tested.
- The Playwright specs remain unexecuted through the runner, because `globalSetup` writes to production Supabase.
- The RLS policy decision from slice 1 is still open.

### Exact next action

**The first visible grouped-pricing slice, for newly generated estimates only.** Create structured rows during new estimate generation, render detailed pricing exactly as today, put grouped mode behind a controlled internal flag, and leave old and sent markdown estimates unchanged. Do not convert any of the 21 eligible production estimates without a separate explicit decision.

---

## Prior session (2026-07-31): Slice 1 COMPLETE, structured schema applied to production

**Slice 1 status: complete and verified. The migration WAS applied to production.** Additive only. No grouped pricing, no backfill, no application wiring, no behaviour change. Full detail in `TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md`.

### Migration and schema files

- `supabase/migrations/20260731000000_create_tpe_estimate_items.sql` (new, and the first file in a new `supabase/migrations/` directory)

The repository had no migrations directory and no CLI workflow. Schema changes are applied through the Supabase MCP `apply_migration` tool, which records them in `supabase_migrations.schema_migrations`. That tool applied this migration under the name `create_tpe_estimate_items`. The repo file is the durable record of the exact SQL, kept in the standard Supabase layout so a CLI workflow can adopt it later without rewriting history.

### What was created

`tpe_estimate_items`: 18 columns, uuid PK, `numeric` for all money and quantities (never floating point), `timestamptz` timestamps with no trigger (this schema has none anywhere). Percentages are whole numbers, so 20 means 20 percent, matching `tpe_businesses.markup_percent`. `customer_visible` defaults to `true` and `taxable` defaults to `true`, both preserving current behaviour. Foreign key to `tpe_estimates(id)` `ON DELETE CASCADE`, matching the closest sibling. No `business_id` duplicate: ownership stays derivable through the estimate.

`tpe_estimates.pricing_source` default `'markdown'`, and `customer_pricing_mode` default `'detailed'`, both check-constrained.

### Generated types

`lib/database.types.ts` regenerated from the live schema via the MCP tool, not hand-edited. Diff is 81 insertions, 5 deletions: the full `tpe_estimate_items` block plus both new columns across the `tpe_estimates` Row, Insert, and Update shapes. The 5 deletions are a PostgREST version bump (13.0.4 to 14.5) and a cosmetic `Args` reformat, both genuine regenerator output. No existing table or column was lost.

### RLS design, and an important finding

**The task assumed owner-scoped policies exist. They do not.** Verified through `pg_policy`, `pg_policies`, `role_table_grants`, and `pg_roles`: all eight pre-existing `tpe_` tables have RLS enabled and **zero policies**, `anon` and `authenticated` hold full table grants, `service_role` bypasses RLS and `authenticated` does not. RLS on with no policy denies all row access, so the real model is **deny-all for anon and authenticated, with the app working entirely through the service-role client and enforcing ownership in code.**

`tpe_estimate_items` was given the identical posture: **RLS enabled, zero policies.** The four owner-scoped `EXISTS` policies the task described were written and reviewed but **deliberately not applied**, because applying them would make this the only table in the schema with live `authenticated` row access, a new access surface the app has no code path for. Not adding one changes nothing about who can reach what. **This needs an explicit decision before any application wiring**, and the ready SQL is in section 9 of the schema document.

### Verification performed

- Constraint enforcement **proved by execution** inside a transaction aborted with `RAISE EXCEPTION` so nothing persisted: all 10 cases correct (blank description, bad `item_type`, negative quantity, markup over 1000, negative `display_order`, bad FK all rejected; valid row and negative monetary amount accepted; bad `pricing_source` and `customer_pricing_mode` rejected). Confirmed 0 rows remained afterwards.
- **RLS runtime verified with the real anon key**, read-only: SELECT returns HTTP 200 with an empty array, identical to `tpe_estimates` and `tpe_businesses`; INSERT rejected HTTP 401, Postgres `42501`.
- Schema introspection: all columns, types, defaults, 7 checks, FK with cascade, 2 indexes present.
- `npx tsc --noEmit` clean. `npx eslint` **25 problems, 7 errors, 18 warnings, identical to the pre-existing baseline**. `npx next build` compiled, 52 static pages. Conversion suite 249 assertions, 0 failures.
- Repository search: **zero** references to `tpe_estimate_items`, `pricing_source`, or `customer_pricing_mode` outside `lib/database.types.ts`. No backfill exists.

### Row-count and preservation checks

Compared against a fingerprint captured immediately before applying:

| Check | Before | After |
|---|---|---|
| Estimate rows | 29 | **29** |
| `max(updated_at)` | 2026-07-30 15:35:03.258894+00 | **unchanged** |
| Content fingerprint (summary, status, sent_at) | `152dab94ef40910e348e7867c08e4439` | **identical** |
| Status split | 25/2/2 | **25/2/2** |
| `pricing_source = markdown` | n/a | **29 of 29** |
| `customer_pricing_mode = detailed` | n/a | **29 of 29** |
| `tpe_estimate_items` rows | n/a | **0** |

`tpe_estimate_line_items` untouched: not dropped, renamed, migrated, or altered. Still deprecated, pending a separate cleanup decision.

### Remaining risks

- **The RLS decision above is open.** Until it is settled, the new table is reachable only by the service role, which is fine for the planned conversion service but blocks any future direct-from-client access.
- **Authenticated-role runtime behaviour was not executed**, only proved by construction (`rolbypassrls = false` plus zero policies). Creating a user to test it would have been a production write.
- **The wide `anon` and `authenticated` table grants are pre-existing on all eight tables** and were not changed. They are inert while RLS denies everything, but any future permissive policy makes them live immediately. Worth a separate review.
- Rollback (`drop table` plus two `drop column`) was not rehearsed.

### Exact next action

**The lazy per-estimate conversion service.** For eligible unsent markdown estimates only: use `parsedToItems()` and `validateConversionTotals()` from `lib/estimate-items.ts` inside a single transaction that inserts structured rows and flips `pricing_source` to `structured` only after every invariant passes, aborting entirely otherwise. It must refuse multi-option estimates (the audit found two) and must never touch a sent or customer-visible estimate. No customer rendering and no editor changes in that slice. Resolve the RLS question before wiring anything to the authenticated client.

---

## Prior session (2026-07-31): production format audit COMPLETE, GATE PASSED

Read-only audit of real stored estimate formats, plus a sanitised fixture export. **No schema, no migration, no application change, no grouped-pricing work.** Full results in `TRADEPULSE_ESTIMATE_FORMAT_AUDIT.md`.

### No production rows changed

**Verified before and after:** 29 rows both times, `max(updated_at)` unchanged at `2026-07-30 15:35:03+00` (the day before the audit), 0 rows updated during the audit window. Nothing was created, updated, or deleted.

### Read-only verification

Project confirmed as `fctequqcwxyhmnjgxixg` ("TradePulse", ca-central-1), the production backend. Controls: dry run by default requiring `AUDIT_CONFIRM_READONLY=yes`; the Supabase client wrapped in a proxy that throws on every write method; a guard self-test that calls `.rpc()` and aborts unless it throws; static grep confirming exactly two database calls, both `.from().select()`; narrow column selection; no raw summaries printed; export gated behind an explicit flag and a residual-PII refusal. Playwright global setup was not run. No SMS, email, reminder, review request, Stripe, or Anthropic call occurred.

### Files added

- `scripts/audit-estimate-summary-formats.ts`, the read-only audit and sanitised exporter (first file in a new `scripts/` directory)
- `tests/fixtures/estimate-summaries/production-sanitised.ts`, generated, 10 fixtures
- `TRADEPULSE_ESTIMATE_FORMAT_AUDIT.md`

### Files modified

- `tests/fixtures/estimate-summaries/index.ts`, exposes the production corpus alongside the preserved synthetic one
- `tests/smoke/estimate-items-conversion.spec.ts`, adds five production-corpus tests
- `TRADEPULSE_ESTIMATES_BASELINE.md`, `HANDOFF.md`

### Aggregate findings

29 estimates audited, all of them. Status: 25 draft, 2 sent, 2 done; 4 customer-visible. Formats: **20 legacy two-column (69.0%)**, 5 five-column (17.2%), 2 multi-option (6.9%), 2 headingless (6.9%). Conversion: **25 pass (86.2%), 4 fail (13.8%)**.

**Every difference measured was zero:** subtotal, tax, grand total, deposit, byte identity, and row count, with maximum absolute differences of 0. All 4 failures are unsent drafts; **all 4 customer-visible estimates pass**. Eligible for lazy migration: 21 (72.4%). Blocked as customer-visible: 4 (13.8%). Manual review: 4 (13.8%).

**Zero stray totals rows found.** The double-counting defect is real in the parser but has not occurred in stored data.

### Main discovery

**Multi-option estimates.** Two drafts were generated as "Good/Better/Best" sets carrying three `## Line Items - Option N` headings each. `parseSummary()` matches that heading by exact equality, so it recognises no priced rows, the estimate totals zero, and the shipped app disables Send. **This is a pre-existing product defect, not introduced here, and was not repaired.** It is also the one architecture assumption that needed widening: an estimate may contain more than one line-item section, and the backfill must refuse such estimates rather than convert part of them. The conversion layer already refuses them. Note that "Good / Better / Best packages" is already a "Consider later" roadmap item; the model is producing them spontaneously today.

One benign finding: a repeated header row inside a single Line Items section, which `parseSummary()` already skips. My audit classifier initially misread it as invalid currency; the classifier was corrected to use the real parser's exclusion rule.

### Verification results

`git status --short` before and after; `git diff --check` clean; full diff review; script inspected and confirmed SELECT-only; dry run, aggregate run, then export run, in that order; **358 conversion assertions across the combined corpus (31 valid, 16 negative), 0 failures**; `npx tsc --noEmit` clean; `npx eslint` **25 problems, 7 errors, 18 warnings, identical to the pre-existing baseline** with zero issues in any new file; `npx next build` compiled successfully, 52 static pages. Repository scan found no UUIDs, JWTs, Supabase URLs, phone numbers, or postal codes in the exported fixtures, and no application code imports the audit script or the production fixtures.

### Gate result

**PASSED**, against all six criteria. See the end of `TRADEPULSE_ESTIMATE_FORMAT_AUDIT.md`.

### Remaining risks

- **Small corpus.** 29 estimates, one business, about four weeks. Formats the schema permits but that have not yet appeared (stray totals rows, group columns, negative amounts, invalid currency) could still arrive. Re-run the audit when the corpus grows materially or the generation prompt changes.
- **RLS and indexes were not inspected.** The audit used the service-role key, which bypasses RLS. `tpe_estimate_items` will need policies consistent with `tpe_estimates`, and the existing ones are unread.
- The claim that multi-option estimates are unsendable is an inference from `calculateEstimateTotal()` and the `isZeroTotal` guard, both read in code but not reproduced in a browser.
- The Playwright specs remain unexecuted through the runner, for the same production-write reason as before.

### Exact next action

**Slice 1: the structured estimate-item schema, and nothing else.** Create `tpe_estimate_items`, add `pricing_source` (default `'markdown'`) and `customer_pricing_mode` to `tpe_estimates`, regenerate `lib/database.types.ts`. Nothing reads or writes the new table; zero behaviour change. Resolve the RLS question first: inspect the existing `tpe_estimates` policies and give the new table consistent ones. Do not build grouped pricing, editor changes, or the backfill in that slice.

---

## Prior session (2026-07-31, earlier): Slice 2 COMPLETE, pure conversion layer, not wired in

**Slice 2 status: complete and passing.** No database table, no migration, no schema change, no UI, no API change, no generation change, no feature flag, and no change to existing estimate storage. **No application behaviour changed.**

### Files added

- `lib/estimate-items.ts`, the pure conversion layer
- `tests/fixtures/estimate-summaries/index.ts`, the synthetic corpus, typed and enumerable
- `tests/smoke/estimate-items-conversion.spec.ts`, the test suite

### Files modified

- `lib/estimate-summary.ts`, an **export-only change** of one word. `lineItemsBlock()` went from module-private to exported, with a comment explaining why. Body and behaviour untouched. This is what lets the new module compare against the one authoritative serializer instead of reimplementing the table, so byte-identity is provable rather than merely intended.
- `TRADEPULSE_ESTIMATES_BASELINE.md`, `HANDOFF.md`

### Conversion functions implemented

`parsedToItems`, `lineItemToDraft`, `draftToLineItem`, `itemsToLineItemsBlock`, `calculateItemTotal`, `calculateItemsSubtotal`, `validateConversionTotals`, `assertConversionSafe`, `findMalformedRows`, `isReservedTotalLabel`, `groupItems`.

Types: `EstimateItemDraft`, `EstimateItemSource`, `MalformedRow`, `MalformedRowReason`, `ConversionValidation`, `EstimateConversionError`. The draft type deliberately separates parsed source text (verbatim cells), calculated numbers, and metadata reserved for later storage. `groupLabel` is always `null`, never an invented category. `tempId` is deliberately non-stable across parses. No `isAllowance` or `customerVisible` field, because today's markdown records neither and inventing a value would be a silent product decision.

### Fixtures

**24 valid, 13 negative, 37 total.** Valid covers: simple two-line, labour only, materials only, mixed, decimal quantities, comma currency, markup already in prices, tax, no tax, percentage deposit, fixed-amount deposit, assumptions, exclusions, payment terms, notes, missing optional sections, multiline prose, similar descriptions, duplicate descriptions, zero-value rows, rounding-sensitive values, a 24-item realistic estimate, a legacy two-column estimate, and an already-edited estimate with no H1. Negative covers: stray subtotal, duplicate totals rows, tax row leak, deposit row leak, empty description, non-numeric amount, invalid currency, group column first, missing header, empty estimate, missing Line Items section, pipe in description, negative amount. All synthetic, no real customer data, no production access.

### Invariant results

**503 assertions, 503 passed, 0 failed.** For all 24 valid fixtures: subtotal difference 0, tax difference 0, grand total difference 0, deposit difference 0, row count preserved, ordering preserved, and the re-rendered `## Line Items` block **byte-identical** to `lineItemsBlock(parsed.lineItems)`. All 13 negative fixtures produced their expected explicit finding, and the 12 blocking ones threw `EstimateConversionError`.

Comparison kinds are stated explicitly in the spec: the **line-item block** is byte-identical, the **full document** is compared semantically, because the shipped serializer legitimately normalises formatting and drops the H1.

### Malformed cases found

Two real findings, both from running the code rather than reasoning about it:

1. **A bug in my own first draft**, caught by the corpus: the reserved-label regex was prefix-anchored and matched "Total station rental", a legitimate priced item. Fixed by anchoring both ends and allowing only a small set of known suffixes and parentheticals. "Taxi to supplier" and "Depositing gravel" are also now correctly treated as ordinary items.
2. **Group-column-first is detected, but via `unparseable-quantity`, not the reserved-row rule.** The current parser reads that table's header row as data, so the header cell "Qty" lands in the quantity column. The refusal is correct; my initial fixture expectation was wrong.

Also recorded: a **fixed-amount deposit is not modelled by the current format**. `parseSummary` recovers only a deposit percentage, so a dollar-only deposit reads as 0 percent. Pinned by fixture 11 as a limitation, not treated as a defect.

### Known parser defect regressions

Both are covered and both leave production behaviour alone:

1. **Stray Subtotal row.** The test asserts the shipped parser still double counts it (subtotal 570 where it should be 285), documenting that unchanged production behaviour, and asserts the conversion layer refuses the estimate.
2. **H1 loss.** The test asserts the round trip does not claim full-document byte preservation, while the line-item block remains byte-identical.

Neither existing-parser defect was fixed here. Fixing the stray-subtotal case in `parseSummary` would change production totals on any affected stored estimate, so it stays a separate follow-up.

### Production wiring confirmation

Repository search for actual import and require statements returns exactly one hit: `tests/smoke/estimate-items-conversion.spec.ts`. No route, page, component, cron, prompt, or database code imports `lib/estimate-items.ts`. The only other mention in `lib/` is a comment in `estimate-summary.ts`.

### Verification results

`git status --short` before and after; `git diff --check` clean; full diff review; `npx tsc --noEmit` clean; `npx eslint` **25 problems, 7 errors, 18 warnings, identical to the pre-existing baseline**, with zero issues in any new or changed file; `npx next build` compiled successfully, 52 static pages.

The 503 assertions were executed by compiling `lib/estimate-summary.ts`, `lib/estimate-items.ts`, and the fixture corpus standalone and running the real functions in Node, with no network and no database.

### Anything still unverified

- **The Playwright spec file itself was not run through the Playwright runner.** `playwright.config.ts` sets `globalSetup` to a function that deletes production `tpe_rate_limits` rows and defaults `baseURL` to the production site. Running any spec triggers that. The spec's assertions were executed directly against the same functions and the same fixture corpus instead, and every assertion in the file has a counterpart that passed. The runner wrapper is unexercised.
- **No real stored estimate was tested.** The corpus is synthetic and explicitly does not claim to represent the production format distribution.
- Whether any stored estimate already carries a corrupted total from the stray-subtotal class of defect. A backfill would faithfully preserve a wrong number.

### Architecture status

**The recorded architecture decision remains valid.** Every synthetic invariant passed, so nothing disproves it and `DECISIONS.md` was not modified. `TRADEPULSE_ESTIMATES_ROADMAP.md` was not modified.

### Exact next action

**A read-only production format audit and corpus export, before any schema work.** All synthetic invariants pass, but no real stored estimate has been tested, so slice 1 (the schema) is not yet justified. The audit should establish, read-only: how many estimates exist; the mix of five-column, legacy two-column, and malformed tables; how many contain a reserved-label row inside the Line Items table; and how many would fail `validateConversionTotals`. Export a sanitised corpus, add it through the existing `EstimateFixture` interface (the suite enumerates whatever is exported, so no test rewrite is needed), and re-run. Create the structured schema only if the real corpus passes too.

---

## Prior session (2026-07-30): grouped-pricing storage architecture DECIDED, documentation only

**No implementation was performed.** No application code, tests, schema, migrations, generated types, dependencies, or configuration changed. Five documentation files only.

### Decision

**Option B, structured line items, scoped narrowly to priced rows.** New deliverable: `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md`, which contains the full comparison, scoring, migration plan, failure modes, and rollback strategy.

- Priced line items move to a new table (working name `tpe_estimate_items`): label, group label, kind, quantity, unit, unit rate, amount, allowance flag, customer-visible flag, sort order.
- Prose (job summary, scope, assumptions and exclusions, payment terms, notes) **stays markdown** in `tpe_estimates.summary`. Only the arithmetic and addressable part moves.
- **Source of truth:** structured rows are authoritative for pricing where `tpe_estimates.pricing_source = 'structured'`, markdown where `'markdown'`. One-way flip inside the backfill transaction. **No dual writes, ever.** Markdown stays permanently authoritative for prose. Approval snapshots, once they exist, outrank both for what a given customer was shown.
- **`tpe_estimate_line_items` is replaced, not reused, and not dropped yet.**

### Primary reasons

Option A (a trailing group column in markdown) is cheaper and was measured genuinely backward compatible, so it was rejected on long-term correctness rather than compatibility. Two defects were measured by executing the real compiled parser:

1. A single stray `Subtotal` row, which the prompt forbids but nothing enforces, is absorbed as a line item and **silently doubled a subtotal from $285 to $570**.
2. The parse-then-serialize round trip **permanently drops the H1 title** on the first edit. Totals were stable and the round trip was otherwise idempotent, and custom sections survived.

Also confirmed: tax rate and deposit percent are already recovered by regex from previously rendered output, and three independent markdown parsers must agree (`parseSummary`, the PDF's own splitter in `lib/generate-pdf.ts`, and `react-markdown`). The two phases queued behind Phase 1 both need what markdown cannot provide: approval snapshots need a verifiable total, and invoice conversion needs stable per line identity for deposit and partial invoices.

`tpe_estimate_line_items` was rejected for reuse on evidence: its generated type is missing eight required fields (unit, unit rate, group label, customer visibility, allowance status, labour hours, labour rate, markup), and its `labour_price`/`material_price` split contradicts the shipped one-cost-per-row model. Separately confirmed: `CLAUDE.md` documents that table's columns incorrectly; the generated types are correct. Left uncorrected, as CLAUDE.md was out of scope for this task.

### Files changed

Added `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md`. Modified `DECISIONS.md` (one new entry, plus a pointer closing the previously deferred question so there are no overlapping entries), `TRADEPULSE_ESTIMATES_ROADMAP.md` (Phase 1 precondition replaced with the decision, plus dependency notes on Phases 2 and 3), `TRADEPULSE_ESTIMATES_BASELINE.md` (reference only, no verified fact altered), and this file.

### Verification performed

`git status --short` before and after, `git diff --check` clean, full diff review of every changed file, and confirmation that no application, test, schema, or configuration file changed. No build, lint, typecheck, or test run was needed, since no application file changed. The two format defects above were proved by compiling `lib/estimate-summary.ts` standalone and running the real functions against format variants, with no network or database contact.

### Exact next implementation slice

**Slice 2 of the five-slice plan: the pure backfill and render functions, plus the totals invariant test.** Deliberately not slice 1 (schema), because slice 2 needs no schema access, no migration, and no production contact, and it is what de-risks the decision. In a new `lib/estimate-items.ts`:

- `parsedToItems(parsed: ParsedSummary): EstimateItemDraft[]`
- `itemsToLineItemsBlock(items): string`, producing markdown byte-identical to today's `lineItemsBlock()`
- A pure test asserting that for a golden corpus of real stored summaries, totals are unchanged in both directions

Nothing wired into the app. No schema change, no route change, no UI change. If that invariant does not hold for real data, the architecture is revisited before any migration.

### Open unknowns that do not block the decision

Indexes and RLS on the new and old tables (no migrations directory in this repo, must be checked in Supabase before slice 1); the count and format mix of stored estimates, needed for the slice 2 corpus; and whether any stored estimate already carries a corrupted total from the stray-Subtotal class of defect, which backfill would otherwise faithfully preserve.

---

## Prior session (2026-07-30, earlier): three confirmed defects fixed

Narrow correctness and access-control repair. **No grouped-pricing work was started.** No schema, migration, generated-type, dependency, or pricing-tier change.

### Defects fixed

1. **Photo deletion sent the wrong field.** The client sent `{ url }` holding a short-lived signed URL; `DELETE /api/estimates/[id]/photos` matches the row on `storage_path`, so every delete returned 400 and photo removal was impossible. The component never received storage paths at all, so `app/estimates/[id]/page.tsx` now passes `photos: { url, storagePath }[]` (it already had `record.storage_path`, it was discarding it) and `estimate-photos.tsx` sends `{ storage_path }`. A failed delete now surfaces the server error and leaves the photo visible; the UI only drops it after the server confirms. Upload behaviour, auth, and ownership checks are untouched.

2. **`mark-paid` overwrote `completed_at`.** `completed_at` means "the job was marked done" and is rendered as the job-done date on `/estimates`. `/api/estimates/[id]/mark-paid` was stamping it with the payment time, destroying the real value, and on an estimate never marked done it invented a completion time that never happened. The route now writes payment state only. No new column: `payment_status`, `invoice_amount`, and `due_date` already carry all payment state. No historical data was touched.

3. **Payments routes had no server-side Pro enforcement.** `/invoice` and `/mark-paid` had no plan check, and the reminder cron did not filter by plan, so a Starter or lapsed account could invoice via a direct API call and have TradePulse send SMS and email to its customers on a schedule. Added one shared predicate, `hasProPaymentsAccess()` in `lib/auth.ts`, used by all three call sites so they cannot drift. It requires `plan === 'pro'` **and** a live subscription (active, complimentary, or an unexpired trial). The subscription half matters because reminders go to the business's customers, not the business. Both routes return 403 `{ error: "Pro plan required" }`, matching the existing convention in `photos/route.ts` and `review-request/route.ts`. The cron filters its already-batched business lookup, so no N+1 was introduced, plus an explicit per-estimate skip, because the send path uses optional chaining and would otherwise have delivered under the fallback name "your contractor". Reminder timing and state rules are unchanged.

### Files changed

`lib/auth.ts` (new shared predicate, existing function untouched), `app/api/estimates/[id]/invoice/route.ts`, `app/api/estimates/[id]/mark-paid/route.ts`, `app/api/cron/payment-reminders/route.ts`, `app/components/estimate-photos.tsx`, `app/estimates/[id]/page.tsx`.

### Tests added

- `tests/smoke/pro-payments-entitlement.spec.ts` (new). Pure unit coverage of the entitlement rule and of the cron's business-selection filter. No browser, no network, no database.
- `tests/smoke/payments-pro-enforced.spec.ts` (new). API-level: Starter invoice and mark-paid both refused with 403 and no writes; after flipping to Pro both allowed; `completed_at` preserved across mark-paid; and mark-paid on an estimate never marked done leaves `completed_at` null.
- `tests/smoke/photo-delete-uses-storage-path.spec.ts` (new). API-level: upload still works, `{ url }` is refused with 400 and deletes nothing, `{ storage_path }` removes both the storage object and the row, unknown paths are refused.

### Verification results

`npx tsc --noEmit` clean. `npx next build` compiled successfully, 52 static pages. `npx eslint` reports **25 problems, 7 errors, 18 warnings, byte-identical to the pre-change baseline**, so this session introduced no lint issues. The pre-existing failures are `react-hooks/set-state-in-effect` in `app/signup/page.tsx:30` and two `@typescript-eslint/no-explicit-any` in `lib/audit-log.ts`; deliberately not fixed, they are unrelated. Dev server booted, `/estimates/[id]` correctly redirected to sign-in, zero console errors and zero server errors.

The entitlement logic was **actually executed**: `lib/auth.ts` was compiled standalone and driven through 22 assertions in Node covering Starter refusal on every subscription status, Pro acceptance on active/complimentary/live-trial, refusal on expired trial, cancelled, past due, and missing data, injected-clock trial expiry, and the exact cron filter. All 22 passed, with no network or database contact.

**The three Playwright specs were not run.** `playwright.config.ts` defaults `baseURL` to `https://trytradepulse.com` and `globalSetup` writes to the production Supabase rate-limit table, and the two API-level specs sign up real accounts and create real Stripe customers. Running them would have meant real Stripe and production writes, which this task prohibited. They follow the existing suite's conventions and are ready for the user to run against a safe target.

### Remaining risks

- The three new Playwright specs are **unexecuted**. They typecheck and follow existing patterns, but their assertions are unproven. Run them before trusting them.
- **Behaviour change worth knowing:** a Pro business whose subscription has lapsed (cancelled, past due, expired trial) can no longer invoice or mark paid, and stops receiving reminder sends. That is the intended fix, but it is stricter than the sibling Pro routes (`photos`, `review-request`), which check plan only. Those were left alone as out of scope. If that inconsistency matters, align them in a separate task.
- No existing paid invoices were migrated. Any estimate whose `completed_at` was previously clobbered by mark-paid still holds the wrong value. Deliberately not touched, per "do not change historical data".
- Photo deletion is fixed at the contract level but **has not been exercised against a real estimate**, for the same production-data reason.

### Exact next action

Decide the storage model for grouped customer pricing before any implementation. Compare extending the existing markdown table format in `lib/estimate-summary.ts` against deliberately migrating to structured line-item storage. Weigh at least: how each option carries a group label per line item, how each keeps internal and customer totals identical, what each does to existing saved estimates, and which one the later approval-snapshot phase can build on. **Do not select or implement an option without that comparison, and do not start Phase 1 code until it is settled.**

---

## Prior session (2026-07-30, earlier): Phase 0 baseline audit COMPLETE, documentation only

**No application code, tests, schema, migrations, generated types, dependencies, or configuration were changed.** Only five documentation files were touched.

Phase 0 of `TRADEPULSE_ESTIMATES_ROADMAP.md` is done. The deliverable is a new file, `TRADEPULSE_ESTIMATES_BASELINE.md`, in the project root. It is the verified source of truth for what TradePulse Estimates actually does today, with every claim labelled Confirmed, Inference, or Unknown and tied to file paths, routes, or database fields. Read it before implementing any roadmap phase. Do not re-derive this from `CLAUDE.md`.

### Material findings

1. **There is no unified estimate status model.** State is spread across `status` (`draft`, `sent`, `done`, `needs_review`), `payment_status` (`null`, `unpaid`, `paid`), `include_photos`, and a set of timestamps. Nothing enforces ordering. No `viewed`, `approved`, `declined`, or `converted` state exists.
2. **Line items are not in a table.** `tpe_estimate_line_items` exists in the schema but no application code touches it. Line items live as a markdown pipe table inside `tpe_estimates.summary`, parsed by `lib/estimate-summary.ts`. The columns `scope`, `assumptions`, `payment_terms`, and `notes` on `tpe_estimates` are likewise unused. This directly constrains Phase 1.
3. **Labour rate and markup are prompt instructions, not code.** `/api/generate-estimate` appends them as plain English to the model message. Only tax, subtotal, and total are recomputed deterministically. Markup is never applied in code.
4. **Phase 5 (photos on customer estimates) is largely already built.** `include_photos` plus the toggle in `estimate-photos.tsx` already controls whether photos appear on the share page and in the PDF. Only per-photo control, captions, ordering, roles, and metadata stripping are missing.
5. **Payments is not real invoicing.** No invoice table, object, document, or number beyond `estimate.id.slice(0,8)`. Marking invoiced writes three fields onto the estimate row and starts the reminder cron.

### Application bugs and risks found (documented, deliberately not fixed)

- **Photo removal is broken.** `estimate-photos.tsx` sends `{ url }` (a signed URL); `DELETE /api/estimates/[id]/photos` requires `{ storage_path }` and returns 400. Confirmed by reading both sides of the contract, not executed.
- **`completed_at` is destroyed by mark-paid.** Mark Job Done sets it to mean job finished; `/api/estimates/[id]/mark-paid` overwrites it to mean invoice paid.
- **`/api/estimates/[id]/invoice` and `/mark-paid` have no server-side Pro check**, and the reminder cron does not filter by plan. Not reachable through the UI, since the invoice button requires `status = 'done'` which only the Pro-gated Mark Job Done sets. Reachable by direct API call.
- **Pre-existing lint failures**, on code this session did not touch: 7 errors, 18 warnings. See the verification section.

### Documentation corrections made

`CLAUDE.md`: `tpe_estimate_photos` documented `file_name` and `note`, neither of which exists (actual: `original_filename`, `mime_type`, `file_size`, `updated_at`); `tpe_estimates` documented a `customer_id` column that does not exist and omitted `include_photos`, `description`, `service_type`, `location`, `urgency`, `updated_at`; `tpe_businesses` pricing columns were undocumented; `tpe_pricebook_items` was missing `description`; `tpe_estimate_line_items` is now flagged unused; the audit log now notes only `sent` is written; the Photo Input section no longer implies all photos are unstored.

`TRADEPULSE_ESTIMATES_ROADMAP.md`: Phase 0 marked complete and pointed at the baseline; the pre-existing Source of Truth block extended to reference the baseline rather than duplicating an equivalent rule; Problem E and Phase 5 corrected for already-built photo inclusion; Phase 1 given the line-item storage precondition; the section 8 data model corrected against the real schema.

`DECISIONS.md`: one new entry, on estimate content being stored as markdown rather than relational rows. That is a genuine unresolved architecture question the audit surfaced, not an observation.

### Verification performed

`git status --short` before and after, `git diff --check`, full diff review of every changed file, `npx tsc --noEmit` (clean), `npx eslint` (7 pre-existing errors, 18 warnings, none from this session since no code changed), `npx next build` (compiled successfully, 52 static pages). A local dev server rendered `/share/<non-existent-uuid>` and `/demo` with zero console errors, zero hydration warnings, zero server errors, and no horizontal overflow at a 412px viewport.

**Not run: the Playwright smoke suite.** It signs up real users, calls the real Anthropic API, and touches live Stripe against what is effectively the production backend. Running it would have created production data, which this task prohibited. Its current pass/fail state is therefore **unknown**.

**Not measured: authenticated estimate editor and populated share page performance.** Both need a real owned estimate, which again means production data. Large-estimate and image-heavy behaviour are unknown. Section 11 of the baseline records this explicitly rather than guessing.

### Exact recommended next implementation phase

**Phase 1, customer-friendly grouped pricing**, chosen from the audit rather than by roadmap numbering. Phase 5 is mostly built. Phases 2 and 3 both need an estimate snapshot and a coherent state model, neither of which exists, and building approval on a mutable markdown blob would let a contractor silently change what was approved. Phase 1 is the only high-priority phase that is genuinely unbuilt and has no hard dependency on the missing state model.

### Exact next action (as recorded earlier on 2026-07-30, now superseded by the top of this file)

Decide where grouped line items will be stored, before writing any Phase 1 code. The three defects referenced here were fixed later the same day.

---

## Prior session (2026-07-30, earlier): roadmap filed, documentation only

**No application code, schema, dependencies, configuration, UI, or behaviour was changed in this session.**

`TRADEPULSE_ESTIMATES_ROADMAP.md` now sits in the project root. It is the product roadmap and specification for TradePulse Estimates: it locks Starter pricing at $39 CAD/month, defines the product boundary, records the current capability baseline, and lays out Phases 0 through 8 with acceptance criteria, an estimate output specification, data model concepts, and success metrics.

The supplied source path `/mnt/data/tradepulse-estimates-roadmap-and-spec.md` does not exist on this machine and could not be read. A file with the required name and matching content was already present in the project root (untracked), so it was reviewed and corrected in place rather than copied. **Unverified:** that this file is byte-identical to the intended source.

### Conflicts found and corrections made to the roadmap

All corrections are inline in the roadmap, dated 2026-07-30, and preserve the verified implementation.

1. Pro plan was listed as including Follow-Up alongside shipped features. Follow-Up is not built. Marked accordingly.
2. Reviews was described as built "elsewhere in TradePulse". It is built inside TradePulse Estimates itself. Reworded.
3. Problem B and Phase 3 implied no invoicing exists. The Pro-gated Payments feature already covers marking an estimate invoiced, marking it paid, reminder cron, and the `/payments` list, with the supporting columns on `tpe_estimates`. Added a correction note that Phase 3 extends Payments rather than replacing it.
4. The data model listed `user_id` on Estimate. Verified schema uses `business_id` referencing `tpe_businesses.id`, with ownership via `owner_user_id`. Corrected.
5. The proposed status list dropped `needs_review`, which is load-bearing for inbound website quote requests. Added a note that it must be preserved.
6. The photos data model duplicated the existing `tpe_estimate_photos` table. Added a note that only `visibility`, `display_order`, and `caption` are new.

Confirmed the roadmap does **not** describe any of these existing capabilities as missing: user-defined labour rates, user-defined and reusable line items, voice input, photo input, SMS sending, email sending, PDF download, shareable estimate links, customer information, assumptions and exclusions, pricing summaries, payment terms, Mark Job Done, Reviews.

`DECISIONS.md` gained three new entries covering the $39 pricing floor, the post-send workflow priority with its explicit do-not-build list, and the rule that the roadmap is direction rather than authorization to build. No existing decision was duplicated or edited.

### Verification performed this session

Documentation review and `git status --short` plus `git diff --check` only. **No build, typecheck, lint, or test run was performed, and none was needed, because no code changed.** The Phase 0 baseline audit described in the roadmap has **not** been performed.

### Exact next action

Run the Phase 0 baseline audit from `TRADEPULSE_ESTIMATES_ROADMAP.md`: document the current estimate state model, confirm how labour rates and saved line items affect generated pricing, confirm photo storage and attachment behaviour, confirm PDF, SMS, email, and share-link behaviour, confirm what Mark Job Done triggers, record estimate page and share-page performance, and record the result back here. Do not begin any implementation phase before that audit is done and reviewed.

---

## Prior state (2026-07-28)

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

## Next action as recorded on 2026-07-28 (superseded by the 2026-07-30 next action above, still open)

Confirm the user wants that session's commit pushed. Otherwise: get more specific detail on the scroll jank, or move to the carried-over Inspection Services planning question.

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
    Checkpoint 2bbe646 committed (not pushed). ONE CONTROLLED END-TO-END
    GENERATION VERIFIED PASS against production: real /new page, real
    Anthropic call, real conversion, structured rows written, totals matched
    the independently recomputed markdown exactly (subtotal/tax/total/deposit
    482.50/24/506.50/0 both ways), detailed rendering on the contractor page
    and share page confirmed unchanged with zero grouped or structured-storage
    terms leaked, grouped renderer against the real rows matched the detailed
    subtotal exactly. All 29 pre-existing estimates remain markdown, untouched.
    A synthetic test business/user/estimate remains in production (deletion
    not reversible, FK prevents partial cleanup); needs a deliberate later
    decision. Next: the contractor-facing grouped-versus-detailed toggle for
    newly generated structured estimates only, now unblocked. Still open: the
    slice-1 RLS policy decision, and the synthetic-account cleanup decision.
  priorContext: >-
    Checkpoint 0ad9605 committed (not pushed). Structured generation now runs
    for NEWLY GENERATED estimates only, assigning work-package groups, strictly
    non-fatal, with the markdown summary preserved and NO renderer changed so
    detailed output is identical by construction. Grouped renderer exists behind
    ESTIMATE_GROUPED_PRICING_INTERNAL, default off, not customer-reachable. All
    29 existing estimates untouched and still markdown. Next: exercise the
    generation path once in a controlled way, since it has never run end to end,
    confirm structured rows and groups are written and rendering is unchanged,
    then design the contractor-facing grouped toggle. Do not convert the 21
    eligible existing estimates without a separate decision. Still open: the
    slice-1 RLS policy decision.
  priorContext: >-
    Checkpoint commit 6f40ddb created on main (not pushed). Lazy conversion
    service COMPLETE and deliberately unwired: lib/estimate-item-migration.ts
    plus the tpe_convert_estimate_to_structured PostgreSQL function, atomicity
    proved by a rolled-back transaction test where a post-insert subtotal
    mismatch rolled the rows back and left pricing_source unflipped. Production
    conversion count is ZERO and tpe_estimate_items is still empty. Next: the
    first visible grouped-pricing slice for NEWLY GENERATED estimates only,
    creating structured rows at generation, rendering detailed pricing exactly
    as today, grouped mode behind an internal flag, old and sent markdown
    estimates unchanged. Still open: the RLS policy decision from slice 1, and
    whether to convert any of the 21 eligible production estimates.
  priorContext: >-
    Slice 1 COMPLETE: tpe_estimate_items created in production (additive,
    0 rows, no wiring), tpe_estimates gained pricing_source default markdown
    and customer_pricing_mode default detailed, all 29 estimates preserved
    byte-identically, lib/database.types.ts regenerated. RLS matches the
    verified deny-all sibling model; the four owner-scoped policies were
    written but NOT applied and need an explicit decision before any
    authenticated-client wiring. Next: build the lazy per-estimate conversion
    service for eligible UNSENT markdown estimates only, using parsedToItems()
    and validateConversionTotals() in one transaction that inserts rows and
    flips pricing_source only after every invariant passes, refusing
    multi-option estimates and never touching a sent estimate. No customer
    rendering or editor changes in that slice.
  priorContext: >-
    Production format audit COMPLETE and the architecture GATE PASSED. All 29
    stored estimates audited read-only, no production row changed, 25 pass and
    4 fail with zero subtotal, tax, grand total, or deposit differences
    anywhere; all 4 failures are unsent drafts and all 4 customer-visible
    estimates pass. Next: Slice 1, the structured estimate-item schema and
    nothing else. Create tpe_estimate_items, add pricing_source (default
    'markdown') and customer_pricing_mode to tpe_estimates, regenerate
    lib/database.types.ts, with nothing reading or writing the new table.
    Resolve RLS first: the existing tpe_estimates policies were not inspected
    and the new table needs consistent ones. Do not build grouped pricing,
    editor changes, or the backfill in that slice. Also open: two multi-option
    draft estimates already total zero and cannot be sent in the shipped app,
    a pre-existing defect left unrepaired; the Playwright specs remain
    unexecuted because globalSetup writes to production Supabase; and from
    2026-07-28, whether to push the earlier commit, the scroll jank on
    /estimates/[id], and the Inspection Services planning question.
  updatedAt: '2026-07-31T00:00:00.000Z'
---
