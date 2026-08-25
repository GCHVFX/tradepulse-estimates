# TradePulse handoff

Updated: 2026-08-24 (Release 1 account-provisioning integrity implemented and verified locally; not committed, not deployed)

## Release 1: account-provisioning integrity (2026-08-24, uncommitted)

**Status:** implemented on `main` in the working tree, fully verified locally, **not committed and not deployed**.

### What it fixes

`app/api/auth/signup/route.ts` created the Stripe customer and the trial subscription before writing the `tpe_businesses` row, and its `dbError` branch deleted the Auth user while leaving both Stripe objects alive. Because the Auth user was the only handle carrying `metadata.user_id`, the surviving customer and its trialing subscription became unattributable. `app/auth/callback/route.ts` had the same asymmetry in `ensureBusiness()`.

### What changed

- **`lib/account-provisioning.ts` (new).** Dependency-injected `provisionNewAccount()`. Runs Stripe customer, then Starter trial subscription, then the business row, and compensates the whole attempt on any failure. No fallback path, so one call can never create two subscriptions.
- **`lib/account-provisioning-server.ts` (new).** Real Stripe/Supabase wiring plus the Sentry reporter. Keeps the saga module free of server-only imports so it stays unit-testable.
- **`lib/stripe-object-state.ts` (new).** `isMissingStripeObject()` (moved here, still re-exported from `lib/stripe-billing-recovery.ts` so the existing name keeps working) and the new `isDeletedStripeObject()`.
- **`app/api/auth/signup/route.ts`**, **`app/auth/callback/route.ts`.** Both now provision through the shared helper. Neither calls Stripe or `auth.admin.deleteUser` inline any more. Success behaviour is byte-identical.
- **`app/api/billing/checkout/route.ts`**, **`lib/stripe-billing-recovery.ts`.** A retrieved Stripe customer carrying `deleted: true` is now treated as missing. Stripe keeps deleted customers retrievable, so a catch-only check let a dead reference through and failed later at session creation instead of recreating the customer.

### Compensation order (after Stripe creation)

Business row, then Stripe customer (which also cancels its subscription), then the Auth user **last**. If any earlier step fails the sequence stops, the Auth user is preserved, and `reportCleanupFailure()` records `userId`, `customerId`, `subscriptionId`, `operation`, and `cleanupStep` to Sentry and the console. Deleting the Auth user while a Stripe object survives is precisely what created the unattributable orphans, so that is never done.

Google OAuth failures always preserve the Auth identity (`deleteAuthUserOnFailure: false`), sign the user out, and redirect to `/signup?error=setup_failed`. A later Google signup by that identity retries provisioning because no business row exists. **No timing heuristic is used anywhere.**

### Verification actually run (2026-08-24)

- `git diff --check`: passed, only the pre-existing benign CRLF notices.
- `npx.cmd tsc --noEmit`: passed.
- Focused new/changed tests (`account-provisioning`, `stripe-object-state`, `stripe-billing-recovery`): **24 passed**.
- Full safe unit suite: **240 passed**, 0 failed (was 219; +21 new).
- `npx.cmd next build`: passed, only the three known `metadataBase` notices.
- Targeted ESLint on all changed and new files: one `prefer-const` error at `lib/stripe-billing-recovery.ts:44`, **confirmed pre-existing** by linting the HEAD version of that file in isolation (same error, line 50 there).

### Corrected baseline

The full-lint baseline recorded below as "7 errors and 18 warnings" is **stale**. The verified current baseline is **8 errors and 18 warnings**, and the eighth is the `prefer-const` error above, which is present at HEAD.

### Read-only orphan diagnostic (2026-08-24, nothing mutated or cleaned)

Live Stripe: 384 customers (0 deleted in the list), 434 subscriptions (210 trialing, 164 past_due, 60 canceled). Only **9** customers are referenced by a `tpe_businesses` row, leaving **375 orphan customers and 425 orphan subscriptions**, every one created in 2026-08 and every one carrying `metadata.user_id`. No customer holds more than one subscription, so orphans are one-per-attempt, consistent with the fixed failure path rather than a duplicate-creation bug.

Supabase: 15 `auth.users` rows, **0 without a business row** (so no unprovisioned identity exists today), against 39 business rows. 34 business rows store a `stripe_customer_id`; 6 sampled ones that are absent from the Stripe list return `resource_missing`, meaning genuinely gone rather than deleted-and-retrievable. **No currently-stored reference to a deleted-but-retrievable customer was found**, so the deleted-customer handling closes a latent gap rather than an observed live failure.

### Authorised live Stripe orphan cleanup (2026-08-24, completed)

The owner explicitly authorised deleting these orphan records, confirming zero real subscribers. Executed with a temporary, auditable script (deleted afterwards), never through the Dashboard. No application code, schema, environment variable, Stripe Product/Price, webhook, or portal configuration was changed.

**Preflight (read-only, all guards passed).** Fully paginated live Stripe: 384 customers, 434 subscriptions, 598 invoices, 164 PaymentIntents, 0 charges. **Zero real money has ever moved in this account**: 0 charges, 0 succeeded PaymentIntents (all 164 sit at `requires_payment_method`, i.e. trials that ended with no card), and 0 invoices with `amount_paid > 0`. All 434 invoices in `paid` status are the $0 invoices Stripe issues for a trial, which is why the paid check requires `amount_paid > 0`, matching the guard the billing webhook already uses.

Target rule: not referenced by any `tpe_businesses.stripe_customer_id`, created in August 2026, has `metadata.user_id`, and no successful charge, paid invoice, or succeeded PaymentIntent. That produced **exactly 375** eligible customers, matching the required guard, with 0 overlap against the 9 referenced customers and 0 targets holding any paid record. Subscription ownership reconciled exactly: 374 on targets, 51 already-canceled on previously deleted customers, 9 on the referenced businesses (8 trialing, 1 past_due), totalling 434.

**Result.** 375 customers deleted, 0 failures, 0 already gone. 374 subscriptions cancelled by that deletion (202 trialing, 163 past_due, 9 already canceled). Stripe transitioned the 163 open invoices to `uncollectible` automatically as part of customer deletion, so the script voided 0 and deleted 0 drafts; `uncollectible` is a terminal state and was deliberately left alone, as were the 374 paid $0 trial invoices.

**Post-cleanup verification.** All 375 targets return `deleted: true`; none still live. 0 target subscriptions remain trialing, active, or past_due. 0 target open or draft invoices remain. Live customers now number 9, exactly the referenced set, and their 8 trialing plus 1 past_due subscriptions are unchanged. Both active CAD Prices and the archived one are untouched. Supabase is byte-for-byte unchanged (39 businesses, 34 with a customer reference, 33 with a subscription reference, 41 estimates, 15 auth users, identical plan/status distribution), and `max(tpe_businesses.updated_at)` remains 2026-08-23, proving no webhook wrote a business row. The single webhook endpoint is still enabled on the canonical URL with its 6 events, and **0 events have `pending_webhooks > 0`**, so nothing failed delivery. The `customer.subscription.deleted` deliveries were correctly no-ops because none of the deleted customers was referenced by a business row.

Note the 25 stored `stripe_customer_id` values that already pointed at absent customers are unrelated to this cleanup and were not touched.

### Authorised deletion of the nine business-linked test accounts (2026-08-24, 8 of 9 completed)

Owner-authorised removal of all nine remaining business-linked test accounts, run through the already-verified `deleteAuthenticatedAccount()` sequence with the same dependency implementations as `app/api/account/delete/route.ts`, so the order and compensation were preserved: claim lease, cancel subscription, remove Storage objects, transactional RPC, Auth user last. Two self-service guards were satisfied administratively because there is no browser session for an operator run: the `DELETE` confirmation string, and the 15-minute re-auth freshness check. No application code, schema, migration, environment variable, webhook, or deployment configuration was changed.

**Preflight (read-only, passed).** Nine unique target customer ids, all nine live in Stripe, no live customer outside the target set, and zero successful payments anywhere in the account (0 charges, 0 succeeded PaymentIntents, 0 invoices with `amount_paid > 0`). Database side: 9 business rows, 7 estimates, 0 photos, 1 logo.

**Result: 8 of 9 accounts fully deleted.** Businesses 39 to 31, estimates 41 to 35, Auth users 15 to 7, live Stripe customers 9 to 0. All nine Stripe customers are deleted and all nine subscriptions are `canceled`, with none left trialing, active, or past_due. Prices untouched. Webhook endpoint unchanged and 0 events undelivered.

**One account could not be deleted, and the cause is a real defect in the deletion path.** The ninth business row has an `owner_user_id` that no longer exists in `auth.users`. `begin_business_deletion` inserts a deletion claim into `tpe_estimate_generation_claims`, whose `owner_user_id` carries a foreign key to `auth.users`, so the insert fails with a foreign-key violation and the lease can never be acquired. `tpe_delete_business_account_data` then refuses with `BUSINESS_DELETION_CLAIM_REQUIRED` because no claim exists. **A business whose owner Auth user is already gone cannot be deleted by the established procedure at all.** Every workaround (manual row deletion, a schema change, or recreating an Auth user to satisfy the constraint) was outside the authorised scope, so the run stopped there rather than improvising.

**Two corrections to the expected counts.** Only 8 of the 9 target `owner_user_id` values actually existed in `auth.users`, so the expected "9 Auth users targeted" and "15 to 6" were off by one; 15 to 7 is the complete result for the 8 deletable accounts. Separately, **24 business rows in total carry an `owner_user_id` absent from `auth.users`**, so this defect is broader than the one blocked account and should be scoped on its own.

**Known partial state.** The runner deleted all nine Stripe customers after the account loop rather than per account, so the blocked account's Stripe customer was deleted even though its database rows remain. That business row now references a deleted Stripe customer and holds 1 estimate, and its `subscription_status` was set to `cancelled` by the normal webhook. It is inert because no Auth user can sign in as it. The Release 1 `isDeletedStripeObject` handling means Checkout would recreate a customer rather than fail on that stale reference. Deleting these remaining rows needs either a fix to the claim path or a separate explicit authorisation.

### Authorised one-off cleanup of ownerless business rows (2026-08-24, completed)

Owner-authorised historical-data cleanup of every `tpe_businesses` row whose `owner_user_id` had no matching `auth.users` record, including the Clearwater Plumbing row left behind by the account deletions above. These rows cannot be removed by the normal account-deletion procedure: `begin_business_deletion` must insert a claim into `tpe_estimate_generation_claims`, whose `owner_user_id` has a foreign key to `auth.users`, so the lease can never be acquired for an ownerless business. That mechanism is for live authenticated accounts and was deliberately not bypassed or modified. No application code, RPC definition, schema, migration, environment variable, Stripe configuration, or deployment configuration was changed, and no Auth user was created or deleted.

**Preflight (read-only, all guards passed).** Dependent tables were derived from the live foreign-key map plus the existing `tpe_delete_business_account_data` RPC. The FK map surfaced two tables the RPC does not handle, `tpe_delivery_claims` and `tpe_photo_upload_reservations` (both CASCADE), and confirmed `tpe_estimate_generation_claims.business_id` is RESTRICT so it must be removed first. Targets: exactly **24** ownerless businesses, Clearwater Plumbing included, none with a null owner. Affected records: 16 estimates, 8 estimate items, 0 legacy line items, 1 estimate photo, 2 estimate changes, 0 payment reminders, 0 price-book items, 0 generation or deletion claims, 0 delivery claims, 0 photo reservations, 10 user-keyed rate limits, 2 logo references. Stripe guard: of their 21 stored customer references, 20 were already missing and 1 deleted, **none live**, with no trialing, active, or past-due subscription and zero charges, succeeded PaymentIntents, or invoices with `amount_paid > 0` anywhere in the account.

**Storage first.** 1 estimate photo removed from `tpe-estimate-photos`. The 2 `logos` paths were already absent, tolerated the same way the production route tolerates a 404. Zero failures, so the database step was allowed to proceed.

**Database.** One atomic `DO` block. It asserted 24 ownerless businesses before deleting and asserted 24 business rows deleted after, either of which would have rolled the whole transaction back. Deletion order: generation claims, delivery claims, photo upload reservations, payment reminders, estimate changes, estimate items, estimate line items, estimate photos, estimates, price-book items, user-keyed rate limits, then the business rows. An earlier attempt aborted cleanly on a `FOR UPDATE` with aggregate error and changed nothing; the retry used the RPC's own subquery-locking pattern.

**Before and after.** Businesses 31 to **7**, estimates 35 to **19**, Auth users 7 to **7** (unchanged), ownerless businesses 24 to **0**, Clearwater Plumbing rows 1 to **0**. Zero orphaned estimates and zero orphaned photos remain. The only surviving claim is a pre-existing expired `generation` claim on a surviving Auth-backed business. All seven remaining businesses are Auth-backed and were not touched. Stripe was not modified by this cleanup and still shows 0 live customers, all 434 subscriptions `canceled`, none trialing, active, or past-due, and all three Prices intact.

## Release 2: no-business access closure and Google intent split (2026-08-24, uncommitted)

**Status:** implemented on `main` in the working tree, verified locally, **not committed and not deployed**. Release 1 (`1a9b4a6`) is live; `origin/main` is at `a7e5471`.

**Read-only production preflight:** **0 Auth users with no `tpe_businesses` row** (8 Auth users, 8 businesses). Nobody is currently in the state this release closes, so it is behaviourally inert for existing users. No Stripe, Supabase, Auth, or production data was mutated.

### 1. `/onboarding` is no longer a business-creation path

`getOrCreateBusiness()` and its `.insert()` are gone. The page now only looks a business up, and never writes `plan`, `subscription_status`, `trial_ends_at`, or any Stripe resource. Previously it minted a `starter` / `trial` row with no Stripe customer or subscription behind it, and `proxy.ts` honoured that as a valid 14-day trial, so any authenticated identity without a business could grant itself unbilled access.

The route is kept so stale links stay safe: a signed-out visitor goes to `/signup`, a no-business identity goes to `/signup?error=setup_required`, and a real business is redirected to `next` (path-validated) or `/estimates`.

### 2. `proxy.ts` no longer redirects to `/onboarding`

The `!business` branch now clears the Supabase session cookies on the redirect response and sends the person to `/signup?error=setup_required`. The old `/onboarding` exemption is removed with it. `/signup` is in `PUBLIC_PATHS`, so `isPublic()` short-circuits before the business lookup ever runs again and the redirect cannot loop.

The session must be cleared on a real response. `createSupabaseServerClient()`'s `setAll` swallows the write during a server-component render, so `signOut()` there looks successful and leaves the session intact. `lib/auth-session.ts` identifies the `sb-<ref>-auth-token` cookies, including the chunked `.0` / `.1` variants.

### 3. Google OAuth intent is bound, not trusted

`lib/oauth-intent.ts` holds a two-value allowlist (`login`, `signup`). `/auth/google` validates the requested intent, generates a nonce, writes `tp_oauth_intent` as `intent.nonce.issuedAt` in an **HttpOnly, SameSite=Lax, 10 minute** cookie, and puts **only the nonce** into `redirectTo`. The intent never appears in any URL.

`/auth/callback` reads the intent from that cookie and trusts it only when the value is on the allowlist, has not expired, was not issued in the future, and its nonce matches the one returned with the redirect. Missing, malformed, unknown, expired, or mismatched all resolve to `null`, and the callback then signs out and redirects to `/signup?error=signin_expired`. The cookie is cleared on every exit path. An unrecognised intent at the start route falls back to `login`, which never creates anything.

### 4. Callback branches

- **Business already exists:** both intents sign in normally. No provisioning, for either.
- **`login`, no business:** no business row, Stripe customer, subscription, or trial is created. Sign out, redirect `/signup?error=setup_required`.
- **`signup`, no business:** the Release 1 compensated helper runs (`deleteAuthUserOnFailure: false`). On failure it cleans partial database and Stripe resources, **preserves the Auth identity**, signs out, and redirects `/signup?error=setup_failed`. No timing heuristic, and no Google Auth user is ever deleted.

Email/password signup, paid/trial logic, webhook mapping, and Stripe Price-ID logic are untouched.

### Verification actually run (2026-08-24)

- `git diff --check`: passed, only the pre-existing benign CRLF notices.
- `npx.cmd tsc --noEmit`: passed.
- Focused new tests (`oauth-intent`, `no-business-access`): **23 passed**.
- Full safe unit suite: **263 passed**, 0 failed (was 240; +23 new).
- `npx.cmd next build`: passed, only the three known `metadataBase` notices.
- Targeted ESLint on all changed and new files: one `react-hooks/set-state-in-effect` error in `app/signup/page.tsx`, **confirmed pre-existing** by linting the HEAD version of that file in isolation. It is one of the 8 baseline errors and is unrelated to the one-line change made there.

### Authorised cleanup of the smoke-test burst, and test-harness hardening (2026-08-24)

**Cause.** A full Playwright smoke run was executed against Production between 19:05:16 and 19:07:52 PT, creating 20 live Stripe Customers with CAD 2900 Starter trials. Nineteen leaked: `cleanupTestAccount()` deleted the Stripe Customer inside a bare `catch {}`, then deleted the database and Auth rows anyway, so the Customers survived with nothing left pointing at them. The twentieth was never cleaned up at all and was the record behind the 7 to 8 count change between 18:57 and 19:17 PT. Both counts had been correct; the record was created between them.

**Preflight (read-only, all guards passed).** 20 live Customers, all inside the burst window, none outside it. All live-mode, all with `metadata.user_id`, none already deleted, each with a trialing CAD 2900 Starter subscription. Account-wide: 0 charges, 0 succeeded PaymentIntents, 0 invoices with `amount_paid > 0`. Database cross-check: 19 with neither Auth user nor business row, 1 Auth-backed with the exact fresh-test signature (47-character plus-alias, provider `email`, matching Stripe references, 0 estimates).

**Cleanup.** The 19 orphans were deleted directly: 19 deleted, 0 already gone, 0 failures, all 19 subscriptions cancelled. The Auth-backed account went through the established `deleteAuthenticatedAccount()` procedure with the route's own dependency implementations, and its Stripe Customer was deleted only after that procedure succeeded and the business row was confirmed gone, so no dangling reference could be created.

**Before and after.** Live Stripe Customers 20 to **0**. Trialing, active, or past-due subscriptions 20 to **0** (all 454 now `canceled`). Auth users 8 to **7**, businesses 8 to **7**, estimates 19 to **19** (the test account had none). Auth users without a business: **0**. Ownerless businesses: **0**. Orphaned estimates: **0**. All three Stripe Prices intact. The seven pre-existing Auth-backed businesses were untouched.

### Rule: fresh-account smoke tests must not run against Production

`tests/smoke/helpers.ts` `signUpFreshAccount()` now **refuses by default** and throws before any network call unless `ALLOW_PRODUCTION_SIGNUP_SMOKE=true` is set for that single run. Refusal is loud, never a silent skip, because a silent skip is how a green run can hide accounts that were never exercised. Anything that is not clearly a local stack counts as Production, and a live-mode Stripe key alone is decisive.

`cleanupTestAccount()` no longer swallows Stripe failures. Stripe cleanup runs first and now **throws** before any database or Auth deletion, so a failure can never again strip away the only record tying a Customer to a user. Only an already-missing Customer is tolerated; only genuinely transient failures (rate limit, lock timeout, `api_error`, 429, 5xx) are retried, bounded at 3 attempts; anything else fails immediately with the Customer id and manual-cleanup instructions. The logic lives in `tests/smoke/smoke-safety.ts` as pure functions, covered by 17 non-network tests in `tests/smoke/smoke-safety.spec.ts`.

**No full smoke suite was run in this session.** Only `playwright.unit.config.ts`, whose `testMatch` allowlist contains pure unit specs with no network access. No account was created.

## USD/CAD multi-currency (2026-08-24, uncommitted, NOT migrated, NOT deployed)

**Status:** implemented in the working tree. The migration file exists but **has not been applied to Production**, and no live Stripe object was modified.

### Migration created but not applied

`supabase/migrations/20260825000000_add_currency_columns.sql`. Additive only, no RLS change, no `SECURITY DEFINER`:

- `tpe_businesses.estimate_currency text not null default 'cad'`, checked `in ('cad','usd')`
- `tpe_estimates.currency text not null default 'cad'`, checked `in ('cad','usd')`

The `not null default 'cad'` backfills every existing row in the same statement, so all 7 businesses and 19 estimates stay CAD with no separate UPDATE. Rollback is `drop column` on both.

**Type-generation blocker.** `lib/database.types.ts` is generated from the live schema, which does not have these columns yet. Regenerating now would reproduce the old schema and hand-editing would fake schema state, so both new columns are read and written **only** through `lib/currency-db.ts`, which carries the narrow casts and the explanation. After the migration is applied, regenerate the types with the Supabase MCP and delete the casts. That is a one-file change.

### Currency model

Billing currency and estimate currency are deliberately separate and never conflated. **Billing currency is not stored**: Stripe locks it to the Customer on the first subscription and is the only authority, so a second copy would drift the moment a contractor changed their estimate currency. **Estimate currency** is a per-business setting, snapshotted onto each estimate at creation so historical estimates never move.

Prices are separate price points, never conversions: Starter CA$29 / US$19, Pro CA$59 / US$39. Amounts always render `CA$` or `US$`; a bare `$` is never emitted.

### Stripe preflight verified read-only (2026-08-24)

| Price | Active | Currency | Amount | Product | currency_options |
|---|---|---|---|---|---|
| `price_1U166oQ45KFNqa8x40e7T41u` | yes, livemode | cad | 2900 | `prod_Uzw4COlgTWZnhc` TradePulse Starter | **cad only** |
| `price_1TzwECQ45KFNqa8xsjncgiHQ` | yes, livemode | cad | 5900 | `prod_Uzw6WQ8HsaqblQ` TradePulse Pro | **cad only** |

Account `acct_1TzvK3Q45KFNqa8x`, country CA, default currency cad, `tax_behavior: unspecified` on both. Archived CAD 3900 Starter remains archived. **No Stripe object was modified.** Note that 5 live customers with trialing subscriptions existed at preflight time, created after the earlier cleanup.

### Verification actually run

- `git diff --check`: passed.
- `npx.cmd tsc --noEmit`: passed.
- Focused new tests (`currency.spec.ts`): **23 passed**.
- Full safe unit suite: **304 passed**, 0 failed (was 280).
- `npx.cmd next build`: passed, only the three known `metadataBase` notices. `/signup` is now dynamic, as expected from reading a request header.
- Full ESLint: **8 errors and 18 warnings, identical to the documented baseline**. The one `set-state-in-effect` error moved verbatim from `app/signup/page.tsx` to `app/signup/signup-form.tsx` with the code.

Five pre-existing tests asserted the old bare-`$` output and the old signup file layout; their expectations were updated to `CA$` and to `signup-form.tsx`, not weakened.

### Estimate rendering coverage now complete

Every customer-facing estimate surface renders the estimate's own persisted `currency` snapshot, never the business setting, so changing `Estimate currency` moves new estimates only:

- **Serializer** (`lib/estimate-summary.ts`): line items, the quantity/rate description, the preamble total, and the whole pricing block. A gap was found and closed here by the new tests: the Line Items table was still emitting `CA$` inside a USD estimate because only the pricing block had been threaded.
- **Editor** (`editable-estimate-body.tsx`): every total, tax, deposit, balance, and per-line amount, plus the inline formatter. Saving re-serializes with the same snapshot, so a save cannot silently rewrite an estimate to CAD. Forwarded from `estimate-pricing-editor.tsx` and the estimate detail page.
- **Reminders** (`lib/payment-reminder-message.ts`): SMS and email HTML both quote the snapshot. The email prose carries no amount. All three callers pass it: the cron (one batched lookup, not one query per estimate), the manual send route, and the Profile preview.
- **Share page and PDF**: the `All amounts in CAD/USD` label, deliberately below the pricing table and outside any cell, because a currency code inside an amount cell would break `parseCost()` on a later edit.

An estimate with no snapshot defaults to CAD, so all 19 existing estimates are unchanged.

**Old-price search.** No stale plan pricing remains on any product surface. The only `$39`/`$69` matches are the deliberately labelled *Superseded* decision record in `DECISIONS.md` (kept as history), unrelated estimate line-item amounts in test fixtures, and the current US$39 Pro price. Nothing was removed from `DECISIONS.md`: superseding is recorded there, not overwritten.

### Five live trialling subscriptions: read-only investigation

All five were created in an eight-second burst, two seconds apart, on the same evening, each with a distinct `metadata.user_id`. Every one is a CAD 2900 Starter trial on the existing Starter Price. **Zero charges, zero succeeded PaymentIntents, and zero invoices with `amount_paid > 0` account-wide.** All five Auth users and business rows are already absent, so no live account is affected. Classification: **all five confirmed test records.**

**Root cause, and it is not the gate failing.** The addresses match `tests/smoke/signup-rate-limit.spec.ts` exactly, whose generated address is ten characters longer than `signUpFreshAccount`'s. That spec creates accounts by POSTing straight to `/api/auth/signup` and **never calls `signUpFreshAccount`**, so the `ALLOW_PRODUCTION_SIGNUP_SMOKE` gate does not apply to it. It deliberately creates exactly five accounts to exhaust the five-per-hour limit, which is precisely what was observed. The gate was already on disk eleven minutes before the burst, so timing is not the explanation: the spec simply is not covered by it.

**Both follow-ups are now closed. See the rule below.**

### Cleanup of the five, and the complete production-smoke rule (2026-08-24)

**Cleanup.** All guards passed before mutation: exactly five customers in the burst window, no live customer outside that set, all CAD 2900 Starter trials, all with no Auth user and no business row, and zero charges, succeeded PaymentIntents, or invoices with `amount_paid > 0` account-wide. Result: **5 deleted, 0 failures.** Verified after: **0 live Stripe customers, 0 trialling/active/past-due subscriptions** (all 459 now `canceled`), all three Prices intact. The database was not touched: 7 businesses, 7 Auth users, 19 estimates, and `max(tpe_businesses.updated_at)` still 2026-08-18, well before this session.

**The rule, now enforced rather than documented.**

Every test-driven POST to `/api/auth/signup` goes through one wrapper, `postSignupApi()` in `tests/smoke/smoke-safety.ts`. It applies the Production gate **before** issuing any request, so a refused run creates nothing, and it accepts only the exact one-run override `ALLOW_PRODUCTION_SIGNUP_SMOKE=true`. `signup-rate-limit.spec.ts`, the spec that bypassed the old gate and created the five, now calls it. A static source test scans every file in `tests/smoke/`, with comments stripped so a comment can neither satisfy nor fail it, and fails if any spec outside the two approved wrapper files posts to that endpoint directly.

**Teardown is now deterministic even with no business row.** `cleanupTestAccount()` resolves the Stripe customer from the business row when present and otherwise from `metadata['user_id']`, so a missing `tpe_businesses` row can never silently skip Stripe again. That silent skip is exactly what let the five survive a teardown that had already removed their database and Auth records. Stripe is resolved and deleted **before** any database or Auth deletion. Only an explicitly already-missing customer is tolerated; only transient failures retry, bounded at three attempts. A failed or ambiguous resolution throws with the user id and the candidate customer ids, and leaves every record needed for recovery in place.

## Currency cutover COMPLETED in Production (2026-08-24)

Steps 1 to 3 of the cutover below are **done**. Only push and deploy remain.

### Migration applied

`supabase/migrations/20260825000000_add_currency_columns.sql` was applied through the Supabase MCP `apply_migration` workflow, byte-identical to the committed file (md5 verified against `HEAD` first). No ad hoc SQL was executed.

Recorded **exactly once** in `supabase_migrations.schema_migrations` as version `20260825035227`, name `add_currency_columns`.

Verified after: `tpe_businesses.estimate_currency` and `tpe_estimates.currency` both exist as `text`, `NOT NULL`, default `'cad'::text`, each with a check constraint `CHECK (col = ANY (ARRAY['cad','usd']))`. **7 of 7 businesses and 19 of 19 estimates read `cad`.** Nothing else moved: RLS policies 9 to 9, public functions 12 to 12, triggers 0 to 0, auth users 7 to 7. `tpe_` constraints went 53 to 55, exactly the two new checks.

### Types regenerated, temporary casts removed

`lib/database.types.ts` refreshed from the now-current Production schema via the Supabase MCP generator. Drift check: the types file declares 25 Row columns for `tpe_businesses` and 36 for `tpe_estimates`, matching the live schema exactly. `lib/currency-db.ts` no longer contains the `AnyClient` cast or its `no-explicit-any` disable, and is now typed against the real `Database`.

### Live Stripe Prices updated

Both existing Prices were re-read immediately before their update and every guard passed. No new Price, no new Product, no change to CAD amounts, default currency, archive state, or the legacy archived CAD 3900 Price. Stripe Tax and automatic tax were not touched.

| | Starter `price_1U166o…` | Pro `price_1TzwEC…` |
|---|---|---|
| Product | `prod_Uzw4COlgTWZnhc` TradePulse Starter, unchanged | `prod_Uzw6WQ8HsaqblQ` TradePulse Pro, unchanged |
| Default currency | cad, unchanged | cad, unchanged |
| CAD | 2900 before and after | 5900 before and after |
| USD | absent → **1900** | absent → **3900** |
| `tax_behavior` | `unspecified` on price, CAD and USD options | same |
| `currency_options` | `['cad']` → `['cad','usd']` | `['cad']` → `['cad','usd']` |

Account-wide after: 3 Prices (unchanged count), 2 Products (unchanged), **0 live Customers**, 459 subscriptions all `canceled`, none active, trialling, or past-due. **No Customer or Subscription was created.**

### Exact Production cutover sequence (steps 1 to 3 now complete)

1. Apply `20260825000000_add_currency_columns.sql` to Production (authorisation still outstanding).
2. Verify all businesses and estimates read `cad`.
3. Regenerate `lib/database.types.ts` and delete the casts in `lib/currency-db.ts`.
4. Confirm `STRIPE_PRO_PRICE_ID` is set in Vercel Production.
5. **Add the two USD currency options in live Stripe**, keeping the existing Price IDs:
   - `price_1U166oQ45KFNqa8x40e7T41u` → `currency_options[usd][unit_amount] = 1900`
   - `price_1TzwECQ45KFNqa8xsjncgiHQ` → `currency_options[usd][unit_amount] = 3900`
   - Set `currency_options[usd][tax_behavior] = unspecified` to match CAD.
6. Re-read both Prices and confirm the IDs, CAD amounts, and Products are unchanged.
7. Deploy, then verify one CAD and one USD signup on a controlled account and clean both up.

Step 5 must land before any USD signup reaches Stripe. Until then a USD subscription create would fail, and it fails loudly rather than silently billing CAD.

### Still deferred after this release

All CAD/USD currency work: the `currency` columns on `tpe_businesses` and `tpe_estimates`, the estimate-currency snapshot and formatters, the Profile `Estimate currency` control, the AI prompt spelling rule, and Stripe `currency_options` (USD 1900 Starter / 3900 Pro) on the existing Price IDs. That work is fully designed and needs Production migration authorization plus confirmation that `STRIPE_PRO_PRICE_ID` is set in Vercel Production. Also still open: a business whose owner Auth user is removed first still cannot be deleted through the normal account-deletion procedure, because the deletion claim has a foreign key to `auth.users`.

**Exact next step:** review the uncommitted Release 2 diff, then commit and deploy if approved. Nothing has been committed, pushed, or deployed.

### Superseded: Release 2 (access control) as originally scoped

`proxy.ts` still redirects an authenticated user with no business row to `/onboarding`, and `app/onboarding/page.tsx` still creates a business row with `plan: 'starter'`, `subscription_status: 'trial'` and **no Stripe customer or subscription**, which `proxy.ts` then honours as a valid trial. That unbilled-trial path is untouched by this release. Release 2 removes the `/onboarding` insert, repoints the proxy redirect to `/signup`, and repoints `safeNextPath()`. The diagnostic above shows 0 accounts currently in that state, so Release 2 is behaviourally inert for existing users. Also deferred: Google `intent` login/signup split, all currency work, Stripe Price `currency_options`, and any migration.

**Exact next action for Release 1:** review the uncommitted diff, then commit and deploy if approved. Nothing has been committed, pushed, or deployed.

## Current state (pre-Release-1 context, retained)

The Profile polish described below was subsequently committed. `main` is now at `c27c563` ("Finalize Profile settings polish") and is level with `origin/main`.

- **Branch:** `codex/profile-settings-mobile-polish`, created from local `main` commit `9399524` (the reviewed reminder-preview terminology correction). Production remains at `6250a9279098060737ea3650c598bfce3618aef1` (`Improve Profile Pro setup mobile UX`), deployment `dpl_G2PhqQG5ZTNSr5EkxoNNvDZoWsmr`, READY. Vercel cron remains disabled.
- **Pending revised Profile mobile polish:** the green bordered review/payment status rows were removed in favour of plain settings copy. The Profile form still stacks logo and company name on mobile, keeps the manual review-link action as a real secondary button, and retains the compact payment-link input. Customer-facing helper copy now describes actual name, phone, and email uses. The collapsed reminder preview uses estimate terminology, a clear example business name before Profile setup, and the same shared formatter as sent SMS.
- **Profile save regression fixed:** the uncommitted `Show business name on estimates` control was sending `show_business_name_on_estimates` through every Profile PATCH, but that column was only in an unapplied local migration and was absent from the generated schema types. The database rejected the update, causing the local “Could not save” state and later apparent default values after re-login. The control, its migration, header/PDF wiring, and its incomplete tests were removed. No existing Profile data was deleted.
- **Persisted setting prerequisite:** a new supported version requires a non-Production Supabase target. There is no local Supabase stack (Docker unavailable) and no Supabase development branch; the only connected TradePulse project is Production. Do not apply or test a new migration until a safe development target is supplied or a narrow Production schema migration is explicitly authorised.
- **Local verification:** `npx.cmd tsc --noEmit` and `git diff --check` passed (only existing CRLF notices). Focused Profile/reminder tests passed (**12 passed**); full safe unit suite passed (**219 passed**). No deployment or provider action was performed. Re-run the same checks immediately before committing.
- **Release constraints:** do not re-enable or invoke Vercel cron. Do not send SMS, create Checkout, complete payment, or alter Stripe, Google, or payment behaviour for this UX change.
- **Pricing:** Starter is **CA$29/month** and Pro is **CA$59/month**. Stripe price IDs remain environment-driven. Production pricing and Checkout paths were verified during the completed cutover.
- **Communications:** remain disabled unless a future task explicitly authorises them.

### Estimate-generation deletion-race verification (local only)

- Root cause confirmed from Production logs: a business was present at the access check but missing for the later `tpe_estimates` insert. Anthropic streaming starts before that insert.
- `git diff --check` passed.
- `npx.cmd tsc --noEmit` passed after the deletion-lease correction.
- Focused estimate-generation claim, account-deletion, and cost-guard tests: 20 passed.
- Full safe unit suite: 218 passed. The two stale manual-reminder source-text assertions were corrected to locate the specific existing reminder timestamp update without depending on line endings; reminder behaviour was not changed.
- The local Supabase CLI cannot validate migrations because no local database is running. Production migration application was confirmed through the Supabase remote migration list. No Production data, deployment, or provider action was performed.
- **Release verification after migration:** `git diff --check` passed, including the reconciled untracked migration; `npx.cmd tsc --noEmit` passed; focused estimate-generation claim, account-deletion, and cost-guard tests passed (**20 passed**); full safe unit suite passed (**218 passed**). Post-migration Supabase security advisors show only the same four pre-existing informational RLS-without-policy notices for service-role-only tables. No new claim-table finding appeared.
- **Exact next action:** commit only the safe Profile-polish files, push and fast-forward `main`, then confirm the Git-triggered Production deployment and perform a constrained authenticated mobile Profile visual check if a controlled browser session is available.

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

- Do not discard, reset, stash, clean, or commit the pre-existing unrelated changes: `.claude/settings.local.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.ai-control-centre/`, the existing `AGENTS.md.bak-*` and `CLAUDE.md.bak-*` files, and `supabase/.temp/`.
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
