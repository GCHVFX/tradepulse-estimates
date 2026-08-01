# TradePulse Estimate Format Audit

Read-only production audit of stored estimate-summary formats, run to decide whether the structured line-item schema is safe to build.

Labels: **Confirmed** (measured against production or executed code), **Inference**, **Recommendation**, **Unknown**.

---

## 1. Audit date

2026-07-31. Repository at branch `main`, base commit `2906fcc`.

## 2. Environment and project confirmed

**Confirmed.** `.env.local` resolves to Supabase project ref `fctequqcwxyhmnjgxixg`, listed in the Supabase account as **"TradePulse"**, region ca-central-1, Postgres 17. This is the production project. Per the project's established constraint, local development and production share this one backend, so there is no separate staging copy to audit instead.

## 3. Read-only safety controls

**Confirmed**, all seven were active:

1. **Dry run by default.** The script refuses to contact production unless `AUDIT_CONFIRM_READONLY=yes` is set. Verified by running it once with no confirmation: it printed "Production was NOT contacted" and exited 0.
2. **Write methods blocked by proxy.** The Supabase client is wrapped so `insert`, `update`, `upsert`, `delete`, `rpc`, `auth`, `storage`, `functions`, `realtime`, `channel`, `removeChannel`, and `removeAllChannels` throw `ReadOnlyViolation` on access.
3. **Guard self-test before any data access.** The script deliberately calls `.rpc()` on the wrapped client and aborts with exit code 2 unless that throws. It printed "Safety check passed".
4. **Static inspection.** Grep for write call sites in the script returns only `createHash().update()` (a crypto hash) and the deliberate `.rpc()` self-test. There are exactly two database calls, both `.from(...).select(...)`.
5. **Narrow column selection.** See section 4.
6. **No raw summaries printed.** Terminal output is aggregate counts plus shape-redacted samples (digits to 9, letters to X).
7. **Export gated.** Fixtures are written only with an explicit `--export` flag and only after the aggregate pass succeeds. Export additionally refuses if any selected fixture still shows residual personal information.

**Confirmed, post-hoc proof that nothing changed:** immediately after the audit, `tpe_estimates` still holds 29 rows, `max(updated_at)` is `2026-07-30 15:35:03+00` (the day before this audit), and 0 rows were updated in the previous 2 hours.

Playwright global setup was **not** run. No SMS, email, reminder, review request, Stripe call, Anthropic call, or deployment occurred.

## 4. Columns queried

**Confirmed.** From `tpe_estimates`: `id`, `created_at`, `updated_at`, `status`, `sent_at`, `payment_status`, `invoice_amount`, `summary`.

From `tpe_businesses`: `name` only, used solely to build an in-memory redaction list, never persisted or printed.

**Not queried:** customer name, customer email, customer phone, job address, business contact details, photo metadata, review data, Stripe identifiers.

`id` never leaves the machine in raw form. It is one-way hashed (SHA-256, truncated) into a local audit identifier used only for console correlation, and no identifier of any kind appears in the exported fixtures.

## 5. Total estimates audited

**Confirmed: 29.** Every stored estimate was audited. None were sampled or skipped. Created between 2026-07-05 and 2026-07-30.

## 6. Status distribution

| Status | Count | Percent |
|---|---|---|
| draft | 25 | 86.2% |
| sent | 2 | 6.9% |
| done | 2 | 6.9% |
| needs_review | 0 | 0.0% |
| **Total** | **29** | **100%** |

Customer-visible (sent, done, or carrying any payment status): **4 (13.8%)**. Payment status: 1 unpaid, 0 paid.

## 7. Format distribution

| Primary format | Count | Percent |
|---|---|---|
| legacy-two-column | 20 | 69.0% |
| five-column | 5 | 17.2% |
| multi-option-sections | 2 | 6.9% |
| no-line-items-section | 2 | 6.9% |
| **Total** | **29** | **100%** |

**Confirmed and notable:** the legacy two-column form is the *majority* of the corpus, not a rare historical leftover. This is not because the estimates are old. It is because `lineItemsBlock()` collapses to two columns whenever no row is quantity-based, so any estimate the model wrote entirely as flat fees is stored two-column. Every estimate is recent (all created within the last month).

Secondary problems detected (an estimate may carry several):

| Problem | Count | Percent |
|---|---|---|
| no-h1 | 7 | 24.1% |
| repeated-header-row | 1 | 3.4% |
| stray subtotal / tax / deposit row | **0** | **0.0%** |
| duplicate total rows | 0 | 0.0% |
| group column present | 0 | 0.0% |
| invalid currency | 0 | 0.0% |
| empty description | 0 | 0.0% |
| negative amount | 0 | 0.0% |
| pipe or malformed table | 0 | 0.0% |
| unexpected extra columns | 0 | 0.0% |
| unsupported header order | 0 | 0.0% |

## 8. Conversion pass rate

**Confirmed: 25 of 29 pass, 86.2%.**

Across all 29 estimates, every difference measured was exactly zero:

| Measure | Result |
|---|---|
| Subtotal mismatches | **0** |
| Tax mismatches | **0** |
| Grand total mismatches | **0** |
| Deposit mismatches | **0** |
| Line-item block not byte-identical | **0** |
| Row count changed on reparse | **0** |
| Max absolute subtotal difference | **0** |
| Max absolute grand total difference | **0** |

## 9. Conversion failure rate

**Confirmed: 4 of 29 fail, 13.8%.** All four fail for the same explicit reason, and all four are unsent drafts.

## 10. Failure categories

| Category | Count | Customer-visible | Cause |
|---|---|---|---|
| multi-option-sections | 2 | 0 | Several `## Line Items - Option N` headings, no bare `## Line Items` |
| no-line-items-section | 2 | 0 | No `## Line Items` heading and no `##` headings at all |

All four surface as `unsupportedStructures: "Estimate has no priced line items."` and are refused by `assertConversionSafe()`. **Zero** failures came from malformed rows, bad currency, or reserved-total rows.

### The multi-option finding

**Confirmed, and this is the significant discovery of the audit.** Two estimates were generated as "Good, Better, Best" option sets. Each carries three `## Line Items - Option N` headings and three matching `## Pricing Summary - Option N` headings.

`parseSummary()` matches the heading with an exact equality test (`h.toLowerCase() === 'line items'`), so a suffixed heading is not recognised as a line-item section at all. Those tables fall through to the generic section handling.

**Inference, with a strong basis:** these estimates already behave incorrectly in the shipped app, independently of this work. With zero recognised line items, `calculateEstimateTotal()` returns 0, so `EstimateActions` shows "Add pricing to your line items before sending" and disables the Send button. That is consistent with both being drafts that were never sent. **This is a pre-existing product defect, not something this slice introduced, and it was not repaired here.**

**Confirmed relevance:** "Good / Better / Best packages" is already listed under "Consider later" in the roadmap. The model is producing them spontaneously today, without product support.

### The two headingless estimates

**Confirmed.** 467 and 651 characters, no `##` headings whatsoever. **Inference:** truncated or failed generations. Both are drafts, never sent.

### The repeated-header-row case

**Confirmed benign.** One estimate has more than one pipe table under a single `## Line Items` heading, so a second header row appears mid-section. `parseSummary()` already skips it, because its row filter drops any row whose first cell starts with "item". This estimate converts cleanly and preserves totals. My audit classifier initially flagged it as invalid currency (reading the header cell "Cost" as an amount); the classifier was corrected to apply the same exclusion rule the real parser uses, and the false positive disappeared.

## 11. Sent estimates affected

**Confirmed: none.**

| Group | Passing | Failing |
|---|---|---|
| Customer-visible (sent / done / invoiced) | **4** | **0** |
| Unsent drafts | 21 | 4 |

Every customer-visible estimate converts with all totals preserved. Every failure is an unsent draft. No customer-visible estimate is at risk, and lazy migration excludes them regardless.

## 12. Potentially corrupted totals

**Confirmed: none found.** Zero stray `Subtotal`, `Tax`, or `Deposit` rows exist inside any `## Line Items` table across all 29 estimates. The double-counting defect identified during architecture analysis is real in the parser but has **not** occurred in stored data.

Consequently there was no case requiring the "record both values, classify for manual review, change nothing" procedure. No estimate had its totals corrected, and no judgement was made about which number would be authoritative.

## 13. Sanitisation process

**Confirmed.** Deterministic, applied by `sanitiseSummary()` in the audit script before anything is written:

- Business names (from the in-memory redaction list, longest match first) become `Example Trades Ltd`
- Email addresses become `customer@example.test`
- URLs become `https://example.test/link`
- Phone numbers become `604-555-0100`
- Canadian postal codes become `V5K 0A1`
- Street addresses become `123 Example Street`, unit and suite designators become `Unit 1`

Customer names, emails, phones, and addresses were **never fetched**, so they could not appear in `summary` unless the model wrote them into the estimate body. The generation prompt passes those as "for context only, do not include in output".

A residual scan runs after sanitisation, looking for anything still shaped like an email, phone, postal code, or URL. **Result: 0 records with residual findings.** Export is hard-refused (exit code 4) if any selected fixture shows a finding.

## 14. Fixtures exported

**Confirmed: 10**, written to `tests/fixtures/estimate-summaries/production-sanitised.ts`. One representative per unique shape (format, problem set, pass or fail, visibility, column count), not one per estimate.

| Fixture | Format | Kind |
|---|---|---|
| prod-01 | no-line-items-section, no-h1 | negative |
| prod-02 | legacy-two-column | valid |
| prod-03 | legacy-two-column (customer-visible) | valid |
| prod-04 | multi-option-sections | negative |
| prod-05 | legacy-two-column, repeated-header-row | valid |
| prod-06 | legacy-two-column, no-h1 | valid |
| prod-07 | no-line-items-section | negative |
| prod-08 | five-column | valid |
| prod-09 | five-column, no-h1 (customer-visible) | valid |
| prod-10 | five-column (customer-visible) | valid |

7 valid, 3 negative. Every format class and both failure classes are represented. The synthetic corpus (24 valid, 13 negative) was preserved unchanged; the combined corpus is now 31 valid and 16 negative.

## 15. Architecture impact

**Confirmed: the recorded architecture decision survives the real corpus.** Structured line items as the authoritative pricing store, with prose remaining markdown, is unaffected. Zero eligible estimates change any total.

**Confirmed, one assumption needs widening.** The architecture document implicitly assumed exactly one `## Line Items` section per estimate. Two production estimates have three. This does not change the storage model (a multi-option estimate would become rows grouped by option, which the planned `group_label` column already accommodates), but it does mean the backfill must recognise and refuse multi-option estimates rather than silently converting the first table or none of them. The conversion layer already refuses them.

**Recommendation:** treat multi-option support as a product decision that belongs with the "Good / Better / Best" roadmap item, not as a migration problem to solve now.

## 16. Migration eligibility

**Confirmed:**

| Category | Count | Percent |
|---|---|---|
| Eligible for lazy migration (passes, unsent) | **21** | **72.4%** |
| Blocked because customer-visible (passes, but excluded by policy) | **4** | **13.8%** |
| Requiring manual review (fails) | **4** | **13.8%** |
| **Total** | **29** | **100%** |

The 4 customer-visible estimates would convert cleanly, but the compatibility rule excludes sent estimates from automatic migration. That policy costs nothing here: they simply stay on the markdown path.

## 17. Estimates requiring manual handling

**Confirmed: 4**, all unsent drafts, none customer-visible.

- 2 multi-option estimates. **Recommendation:** leave them. They are already unsendable in the shipped app, and repairing them is a product decision about option pricing, not a migration task.
- 2 headingless estimates, probably failed generations. **Recommendation:** leave them, or let the owner delete them. They contain no usable pricing.

None require repair for the schema slice to proceed, because none is eligible for migration.

## 18. Unknowns and limitations

- **Unknown: how representative this corpus is of future data.** 29 estimates from one business over about four weeks is a small, early corpus. A format that has not yet appeared could still appear. In particular, no estimate yet contains a stray totals row, a group column, a negative amount, or an invalid currency, all of which the format permits.
- **Unknown: RLS policies and indexes.** Not inspected. The audit used the service-role key, which bypasses RLS, so nothing here says whether RLS is correct.
- **Unknown: whether the two headingless drafts are truncated generations or something else.** Their content was not read beyond structure and length.
- **Inference, not measured: that multi-option estimates are unsendable in the app.** This follows from `calculateEstimateTotal()` returning 0 and the `isZeroTotal` guard in `EstimateActions`, both read in the code, but it was not reproduced in a browser against one of these estimates.
- **Limitation: the audit classifier is not the production parser.** It reads raw markdown to describe shapes that `ParsedSummary` erases. Its data-row exclusion rule was aligned with the real parser after a false positive, but it remains a separate piece of code used for description only. It never decides a price.
- **Confirmed limitation: only one business exists in this database.** The redaction list had one entry. A multi-business corpus would exercise sanitisation harder.

## 19. Recommendation

**Proceed to the schema slice.** The evidence is strong: every estimate that would ever be migrated preserves its subtotal, tax, grand total, and deposit exactly, with a byte-identical line-item block and no row-count drift. The maximum observed difference on any measure is zero. No stored estimate carries the corruption the architecture analysis warned about. No customer-visible estimate is affected.

Two conditions to carry forward into that slice:

1. The backfill must refuse multi-option estimates explicitly. The conversion layer already does; the migration must not bypass it.
2. Re-run this audit when the corpus is materially larger or when the generation prompt changes, since format drift is driven by the model.

## 20. Exact next implementation slice

**Slice 1: the structured estimate-item schema, and nothing else.**

Create `tpe_estimate_items` and add `pricing_source` (default `'markdown'`) plus `customer_pricing_mode` to `tpe_estimates`. Regenerate `lib/database.types.ts`. Nothing reads or writes the new table. Zero behaviour change.

Before writing the migration, resolve the RLS question in section 18: `tpe_estimate_items` needs policies consistent with `tpe_estimates`, and the existing policies were not inspected by this audit.

Do not build grouped pricing, the editor changes, or the backfill in that slice.

---

## Architecture decision gate

### GATE PASSED

**Confirmed against all six criteria:**

1. **Every migration-eligible estimate preserves totals.** 21 eligible, 0 differences on subtotal, tax, grand total, or deposit. Maximum absolute difference on any measure: 0.
2. **Every malformed or ambiguous estimate is identified.** 4 failures, all explicitly refused, all explained: 2 multi-option, 2 headingless.
3. **Sent estimates remain protected.** All 4 customer-visible estimates pass, and all are excluded from lazy migration by policy regardless. 0 customer-visible failures.
4. **No unexplained format class remains.** All 29 estimates classified: 20 legacy two-column, 5 five-column, 2 multi-option, 2 headingless. The one initially unexplained signal (an invalid-currency flag) was traced to a false positive in the audit classifier and corrected.
5. **Sanitised fixtures cover the real corpus.** 10 fixtures spanning every format class and both failure classes. 0 residual personal information. No production identifier in the repository.
6. **The architecture decision remains valid.** Structured items authoritative for pricing, prose in markdown, `tpe_estimate_line_items` replaced. One assumption widened: an estimate may contain more than one line-item section, and such estimates must be refused rather than partially converted.

**No production row was created, updated, or deleted.** Verified before and after: 29 rows, `max(updated_at)` unchanged at 2026-07-30, 0 rows touched in the audit window.
