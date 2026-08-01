# Handoff

Updated: 2026-07-30 PDT

## Latest session (2026-07-31, latest): checkpoint commit + lazy conversion service

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
