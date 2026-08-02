# Lazy Per-Estimate Conversion Service

Labels: **Confirmed** (verified by execution), **Recommendation**, **Unknown**.

---

## 1. Purpose

Convert one eligible markdown-authoritative estimate into structured rows in `tpe_estimate_items`, atomically, and flip `tpe_estimates.pricing_source` to `structured` only if every invariant holds.

**Updated 2026-07-31 (commit `2bbe646`):** the service is now called from `/api/generate-estimate` for every newly generated estimate, immediately after saving it. The call uses `dryRun: false, assignGroups: true` and is best-effort, non-fatal: any refusal or error leaves the estimate markdown-authoritative. **The lazy path (for existing estimates) remains unwired**: no user action, editor save, page load, or cron invokes the service for pre-existing estimates. **One production estimate has been converted** (the authorized synthetic test estimate from the E2E verification; all others remain `pricing_source = 'markdown'`).

Files: `lib/estimate-item-migration.ts` and `supabase/migrations/20260731010000_create_convert_estimate_to_structured_fn.sql`.

## 2. Eligibility rules

**Confirmed** enforced, and enforced twice: once in TypeScript before the call, and again inside the database function under a row lock. The second check is the one that counts, because only it is race-free.

An estimate converts only when all hold:

- `pricing_source = 'markdown'`
- `sent_at` is null
- `status` is not `sent`
- `status` is not `done`
- no structured rows already exist for it
- the summary has one bare `## Line Items` section, not option variants
- at least one priced row parses
- `validateConversionTotals()` returns `ok`
- subtotal, tax, grand total, and deposit differences are all exactly zero
- no blocking malformed row is found

## 3. Refusal reasons

**Confirmed** as a closed typed set, `ConversionRefusalReason`:

| Reason | Meaning |
|---|---|
| `ESTIMATE_NOT_FOUND` | No estimate with that id under the caller's business |
| `NOT_OWNED_BY_BUSINESS` | The database refused ownership under the lock |
| `NO_BUSINESS_FOR_USER` | The authenticated user has no business row |
| `ALREADY_STRUCTURED` | `pricing_source` is already `structured` |
| `ESTIMATE_SENT` | Status is `sent` |
| `ESTIMATE_DONE` | Status is `done` |
| `ESTIMATE_CUSTOMER_VISIBLE` | `sent_at` is set, so a customer may already have seen it |
| `MULTI_OPTION_ESTIMATE_UNSUPPORTED` | Several `## Line Items - Option N` headings |
| `NO_PRICED_ITEMS` | The parser found no priced rows |
| `MALFORMED_ROWS` | A blocking malformed row, such as a stray totals row |
| `TOTALS_MISMATCH` | Any of the four totals would change |
| `STRUCTURED_ROWS_ALREADY_EXIST` | The database found rows under the lock |
| `INCONSISTENT_STATE` | Rows exist while `pricing_source` is still `markdown` |
| `TRANSACTION_FAILED` | The transaction rolled back for any other reason |

**Confirmed:** raw database errors are logged server-side and never returned to a caller.

## 4. Ownership model

**Confirmed.**

- The service takes a `userId`, never a business id. The business is resolved by `owner_user_id`, so **a client-supplied business id cannot be used at all**, let alone to reach another business's estimate.
- The estimate is loaded with both `id` and `business_id` predicates, so a foreign estimate reads as `ESTIMATE_NOT_FOUND` rather than leaking that it exists.
- The database function re-checks ownership with a `business_id` predicate on a `SELECT ... FOR UPDATE`, so ownership is confirmed under the lock, not just before it.
- Service-role database access is used only after ownership is established in application code.
- **Confirmed by execution:** a cross-business call raises `ESTIMATE_NOT_FOUND_OR_NOT_OWNED` and writes nothing.
- **Confirmed:** `EXECUTE` on the function is granted to `service_role` only. `anon` and `authenticated` are revoked, so no public or share-page path can reach it. `postgres` retains it as table owner, which is unavoidable and expected.

## 5. Dry-run behaviour

**Confirmed.** `dryRun` defaults to `true`, so an accidental call writes nothing.

A dry run performs the full load, ownership check, every eligibility check, the parse, the conversion, and the totals validation, and returns a complete populated result. It then stops before the RPC. `transactionApplied` is `false` and `resultingPricingSource` equals `previousPricingSource`, so the result never implies a change that did not happen.

Repeated dry runs are safe and side-effect free.

## 6. Transaction design

**Confirmed atomic, because it is one PL/pgSQL function body, which Postgres runs in a single transaction.** This is not sequential service-role calls dressed up as a transaction.

**Why a function.** PostgREST cannot span a transaction across separate HTTP calls. Inserting items and flipping `pricing_source` as two `supabaseAdmin` calls would leave a window where a failure produces structured rows behind an estimate still marked `markdown`, which is precisely the dual-source state the architecture forbids. The project already uses exactly this pattern for `increment_rate_limit`, including the `p_` argument prefix.

Order inside the function:

1. `SELECT ... FOR UPDATE` the estimate by id and business id, locking it.
2. Re-check `pricing_source`, `sent_at`, and `status` under the lock.
3. Refuse if any `tpe_estimate_items` row already exists.
4. Validate the payload is a JSON array whose length matches `p_expected_count`.
5. Insert, reading only 14 known keys. `estimate_id` comes from the argument, never the payload.
6. `GET DIAGNOSTICS` the inserted count and compare it to the expected count.
7. Re-sum `line_total` **from the table** and compare to `p_expected_subtotal`. A caller-supplied total is never trusted.
8. Update `pricing_source` to `structured`.

Any `RAISE` at any step rolls back every insert and the update together.

**Security model:** `SECURITY INVOKER` (the default), deliberately not `DEFINER`. There is no privilege to escalate, since the only caller is the service-role client which already bypasses RLS. Running as invoker means that if the function were ever reached by `anon` or `authenticated` it would be subject to their deny-all RLS instead of running with owner rights. `EXECUTE` is revoked from `public`, `anon`, and `authenticated`; Postgres grants it to `PUBLIC` by default, so the revoke is required, not decorative.

## 7. Row mapping

**Confirmed** by 130 executed assertions. Deliberately conservative: nothing is inferred from description text.

| Column | Value |
|---|---|
| `description` | parsed description, verbatim |
| `quantity` | parsed quantity for a quantity row, `1` for a flat fee |
| `unit` | parsed unit text, `null` for a flat fee |
| `unit_price` | parsed unit rate for a quantity row, the row total for a flat fee |
| `line_total` | the customer-visible row total |
| `group_label` | `null` |
| `customer_visible` | `true` |
| `display_order` | original row order |
| `item_type` | `'other'` |
| `is_allowance` | `false` |
| `labour_hours`, `labour_rate`, `markup_percent` | `null` |
| `taxable` | `true` |

**The flat-fee rule, stated explicitly:** a flat fee has no unit rate in the source, so `quantity` stays 1 and `unit_price` equals `line_total`. That keeps `quantity * unit_price = line_total` for every row without inventing a rate.

**Confirmed not inferred:** a row described "Labour, demolition" still gets `item_type = 'other'`; "Tile allowance" still gets `is_allowance = false`; "Materials, marked up" still gets `markup_percent = null`. Guessing any of these would be this slice making a product decision nobody has taken.

**Confirmed:** the payload carries only the 14 mapped keys. No `id`, no `estimate_id`, no arbitrary column name.

## 8. Idempotency

**Confirmed by execution against the real function:**

- Repeated dry runs are safe.
- The first real conversion succeeds and inserts every row.
- A second call refuses with `ALREADY_STRUCTURED`, and the row count stays at 2, so **no duplicates are possible**.
- Rows existing while `pricing_source` is still `markdown` refuse with `STRUCTURED_ROWS_ALREADY_EXIST` in the database and `INCONSISTENT_STATE` in the service.

## 9. Multi-option handling

**Confirmed detected and refused** with `MULTI_OPTION_ESTIMATE_UNSUPPORTED`.

`detectsMultiOptionStructure()` flags a summary that has `## Line Items` headings but no bare one, or more than one. Detected variants include `- Option N`, a plain descriptive suffix such as `- 6 Gauge Galvanized`, and a parenthesised `(Option A)`.

This is deliberately a distinct reason rather than falling through to `NO_PRICED_ITEMS`. The estimate does have prices; this converter simply cannot represent them yet. **Confirmed no partial parse and no flattening.** **Confirmed the two real production multi-option estimates are detected**, via their sanitised fixtures. They were not repaired.

## 10. Failure and rollback behaviour

**Confirmed by execution.** Every case below ran against the real function inside a transaction deliberately aborted with `RAISE EXCEPTION`, so nothing persisted.

| Case | Result |
|---|---|
| Happy path | 2 rows inserted, `pricing_source = structured`, returned count 2 |
| Second conversion | Refused `ALREADY_STRUCTURED`, still exactly 2 rows |
| Sent estimate | Refused, 0 rows, source still `markdown` |
| Cross-business | Refused `ESTIMATE_NOT_FOUND_OR_NOT_OWNED` |
| Item count mismatch | Refused, **0 rows**, source still `markdown` |
| **Subtotal mismatch after insert** | Refused, **inserts rolled back to 0 rows**, source still `markdown` |
| Pre-existing rows | Refused `STRUCTURED_ROWS_ALREADY_EXIST` |
| Empty payload | Refused `NO_PRICED_ITEMS` |
| Summary | Unchanged throughout |

**The subtotal-mismatch case is the definitive atomicity evidence.** Rows were genuinely inserted, a later check failed, and the rows disappeared together with the unflipped source. That could not happen with sequential API calls.

On failure the service returns a typed result with `success: false`, `transactionApplied: false`, and `resultingPricingSource` equal to the previous value.

## 11. Production wiring status

**Updated 2026-07-31 (commit `2bbe646`):**

- `app/api/generate-estimate/route.ts` now imports `convertEstimateToStructuredItems` from `lib/estimate-item-migration.ts` and calls it after every new estimate is saved.
- The call is best-effort and strictly non-fatal; any refusal or error leaves the estimate markdown-authoritative. Controller close happens after the conversion attempt.
- No other route, component, cron, or user action calls the service. The lazy conversion path (for pre-existing estimates) remains unwired to any trigger.
- One production end-to-end generation test was run (the authorized synthetic estimate). The common well-formed path succeeded. Multi-option and unsafe estimates refuse before any write. See `TRADEPULSE_ESTIMATES_BASELINE.md` section 16.

**Production state after the first authorized generation test:** `tpe_estimates` holds **30** rows; **29** remain `pricing_source = 'markdown'`; **1** (the synthetic test estimate) is `pricing_source = 'structured'`; `tpe_estimate_items` holds **4** rows, all for the one structured estimate. The content fingerprint `152dab94ef40910e348e7867c08e4439` and `max(updated_at)` `2026-07-30 15:35:03.258894+00` are unchanged for the 29 pre-existing estimates.

## 12. Tests

**Pure unit, executed, 130 assertions, 0 failures.** Multi-option detection including production fixtures, row mapping (description, quantity, unit, unit price, row total, order), the flat-fee rule, the no-inference guarantees, the defaults, the key whitelist, and mapped-subtotal preservation across all 31 valid fixtures.

**Transaction, executed against the real database function, 9 cases, all correct**, inside an aborted transaction using fixtures created and rolled back in the same transaction. See the table in section 10.

`tests/smoke/estimate-item-migration.spec.ts` holds the Playwright-shaped versions of the pure cases, following existing project convention.

## 13. Unverified items

- **The Playwright spec was not run through the Playwright runner.** `playwright.config.ts` sets a `globalSetup` that deletes production `tpe_rate_limits` rows and defaults `baseURL` to the production site. Every assertion in it was executed directly against the same functions instead, but the runner wrapper is unexercised. This applies to all specs in this repository, not just this one.
- **The TypeScript service was not executed end to end.** Its pure pieces ran in isolation and its database half ran directly, but `convertEstimateToStructuredItems()` itself was never invoked, because doing so requires a real authenticated user and either a real conversion or writes this task forbade. **Unknown: the exact behaviour of its error mapping and result assembly under a live call.**
- **Ownership tests ran at the database layer only.** The cross-business refusal was proved inside the function. The TypeScript-layer checks (`NO_BUSINESS_FOR_USER`, `ESTIMATE_NOT_FOUND` for a foreign estimate) were read, not executed.
- **Anonymous refusal is proved structurally**, by the revoked `EXECUTE` grant plus deny-all RLS, not by an executed anonymous call to the service.
- **Unknown: behaviour under real concurrency.** The `FOR UPDATE` lock is the correct mechanism and was reasoned through, but two simultaneous conversions of one estimate were not raced in practice.
- **Unknown: performance on a large estimate.** The 24-item fixture maps fine, but no timing was taken.

## 14. Exact next slice

**Complete (2026-07-31, commit `2bbe646`).** Structured rows are now created at generation time with `assignGroups: true`, detailed rendering is byte-for-byte unchanged, grouped mode is behind `ESTIMATE_GROUPED_PRICING_INTERNAL` (default off), and existing estimates are untouched.

**Exact next slice:** implement the contractor-facing grouped-versus-detailed pricing toggle for newly generated structured estimates only. Preserve detailed mode as the default. Do not alter, migrate, or reinterpret existing markdown estimates.

Still open from earlier slices: the RLS policy decision (`TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md` section 9), and whether to convert any of the 21 eligible pre-existing production estimates (currently zero, no decision made).

Before that, or alongside it, two open items from earlier slices still need decisions: the RLS policy question in `TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md` section 9, and whether to convert any of the 21 eligible production estimates, which remains deliberately at zero.
