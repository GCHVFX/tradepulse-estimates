# Grouped Customer Pricing: Storage Architecture Decision

Date: 2026-07-30. Branch `main`, base commit `2906fcc`.
Prerequisite reading: `TRADEPULSE_ESTIMATES_BASELINE.md` (Phase 0 audit), roadmap Phase 1.

Every material statement below is labelled **Confirmed** (read in the current source, generated types, or executed against the real compiled code), **Inference**, **Recommendation**, or **Unknown**.

---

## 1. Decision summary

**Recommendation: Option B, structured line-item storage, scoped narrowly to priced rows only.**

Specifically:

- Priced line items move to a new, corrected structured table. Structured rows become authoritative for all pricing.
- The markdown `summary` column stays, and stays authoritative for prose (job summary, scope, assumptions and exclusions, payment terms, notes). It is no longer authoritative for line items or totals: those are rendered from structured data.
- `tpe_estimate_line_items` is **replaced, not reused**. Its shape is wrong for the shipped pricing model.
- Migration is lazy and per estimate, never a bulk rewrite. Sent estimates are never silently rewritten.

**Confirmed** this is not the cheaper option. Option A (a trailing group column in markdown) is genuinely viable and about a quarter of the work. It was rejected because the audit plus the experiments in section 4 show markdown is already failing as a storage format for arithmetic, and the two phases queued immediately behind grouped pricing (approval snapshots, invoice conversion) both need per line integrity that markdown cannot enforce.

---

## 2. Current implementation

### 2.1 Generation

**Confirmed.** `app/api/generate-estimate/route.ts`. A single `SYSTEM_PROMPT` instructs `claude-haiku-4-5-20251001` to emit a fixed nine-section markdown document. Line items must be a five-column pipe table (`Item | Qty | Unit | Rate | Cost`). Business pricing reaches the model as plain-English appended lines (`route.ts:144-166`): labour rate, materials markup, price book items (`name: $labour_price` only), tax label and rate, and a conditional deposit rule. The response streams straight to the client and is saved as one markdown blob.

**Confirmed.** Markup is never applied in code. The prompt says "Never show markup as a separate line item. Apply markup to material prices directly." Whether markup was actually applied is unverifiable after the fact.

### 2.2 Storage

**Confirmed.** `tpe_estimates.summary` (text) holds the entire estimate document. `title` is a separate column. The columns `scope`, `assumptions`, `payment_terms`, and `notes` exist and are **never read or written** by application code. `tpe_estimate_line_items` exists and is **never read or written** by application code (only `tests/smoke/helpers.ts:167` deletes from it during teardown).

**Confirmed.** There is no `supabase/` directory and no migration files in the repository. Schema is managed outside this repo, so `lib/database.types.ts` is the only in-repo schema source of truth. **Unknown:** indexes and RLS policies on `tpe_estimate_line_items`, since neither is visible from the repository.

### 2.3 Representation of each section

**Confirmed.** All of it is markdown inside `summary`:

| Content | Representation |
|---|---|
| Job title | `# ` H1 line, stripped at parse time |
| Job summary and estimated total | Preamble prose before the first `## ` |
| Scope of work | `## Scope of Work` with `- ` bullets |
| Line items | `## Line Items` pipe table, 5 columns (or 2 in legacy estimates) |
| Assumptions and exclusions | A "before pricing" `## ` section with bullets |
| Pricing summary | `## Pricing Summary` pipe table, fully regenerated on every parse |
| Payment terms, notes | "After pricing" `## ` sections, free text |

### 2.4 Line item encoding

**Confirmed.** `lib/estimate-summary.ts parseSummary()` (line 151). A row becomes a `LineItem { id, label, cost, quantity?, unit?, rate?, quantityBased? }`. `quantityBased` is decided once, strictly, from the raw cells: `Boolean(cells[1]) && Boolean(cells[3])`. Rows with fewer than 5 cells are read as flat fees (legacy two-column path). The decision is deliberately not re-derived later; the extensive comment at `estimate-summary.ts:69-88` explains that computing it live breaks mid-edit.

### 2.5 Editing

**Confirmed.** `app/components/editable-estimate-body.tsx` (830 lines). It calls `parseSummary(summary)` once into React state (line 84), lets the contractor edit scope bullets, line items, assumptions, and prose, then after a 4 second debounce calls `serializeSummary(...)` and PATCHes the whole regenerated `summary` string back (lines 173-190).

**Confirmed, and important:** the edit path is a full document rewrite, not a patch. The stored markdown after any edit is whatever the serializer produces, not what the model wrote.

### 2.6 Regeneration

**Confirmed.** There is no regenerate-in-place. `/api/generate-estimate` always creates a new estimate. The only other writer of `summary` is `EstimateActions.handleCreateEstimate()` (`estimate-actions.tsx:204-213`), which converts a `needs_review` website quote request into a draft using `buildDraftSummary()` from `lib/quote-templates.ts`, emitting the same section structure.

**Confirmed.** There is no duplicate or copy-estimate feature. Grep for duplicate/clone/copyEstimate returns nothing outside the copy-link flow.

### 2.7 Totals

**Confirmed.** Totals are always recomputed in code, never trusted from the stored text. `computeTotals()` (`estimate-summary.ts:130`) sums `lineItemCost()`, where a quantity item is `quantity * rate` and a flat fee is its typed cost. Tax is `round(subtotal * taxRate/100)`. Deposit is `round(total * depositPercent/100)`.

**Confirmed.** `depositPercent`, `taxLabel`, and `taxRate` are recovered **by regex from the rendered Pricing Summary markdown** (`estimate-summary.ts:229-235`), not read from `tpe_businesses` at display time. The stored pricing table is therefore both an output and an input.

### 2.8 Customer display derivation

**Confirmed.** `formatEstimateForDisplay()` (`estimate-summary.ts:370`) re-parses the stored summary and re-serializes it in display order, collapsing the 5-column table to 2 columns via `displayLineItemsBlock()`, folding quantity and rate into the label text ("Labour (3 hrs @ $95.00/hr)"). The share page (`app/share/[id]/page.tsx:118`) and the PDF button both feed from it.

### 2.9 Who parses markdown into structured data

**Confirmed: three independent parsers, all of which must agree.**

1. `lib/estimate-summary.ts parseSummary()`. Editor state, totals, and display formatting.
2. `lib/generate-pdf.ts`. Its **own** section splitter (lines 61-83) and generic pipe-table reader (lines 212-224). It calls `formatEstimateForDisplay()` and then re-parses the resulting string.
3. `react-markdown` inside `app/components/estimate-markdown.tsx`. Renders the share page and the contractor detail view.

**Inference:** any change to the line-item table shape has to be validated against all three, and only the first has tests.

### 2.10 Is markdown authoritative or presentational?

**Confirmed: authoritative.** It is the only durable record of line items, quantities, rates, deposit percent, tax label, and tax rate. Nothing else stores them. The structured `LineItem[]` form exists only transiently in browser memory.

---

## 3. Requirements

Drawn from roadmap Phase 1 plus the decision constraints.

1. Customer sees 3 to 8 grouped work-package price lines by default; contractor can switch to detailed.
2. Group totals must exactly equal detailed totals.
3. Internal line-item data must never be discarded.
4. PDF, share page, SMS link, and email link must all show the selected mode.
5. Existing saved estimates must keep rendering correctly.
6. No silent change to any total, especially on an already-sent estimate.
7. One source of truth per concern, permanently.
8. Must not block future immutable approval snapshots, revisions, or invoice conversion.
9. Must stay practical on a phone.

---

## 4. Option A: Extended markdown

Add a group label to each line item row inside the existing markdown table.

### 4.1 Concrete format

**Recommendation** for how it would look if chosen. The group column must go **last**, for reasons proved in 4.2:

```markdown
## Line Items
| Item | Qty | Unit | Rate | Cost | Group |
|------|-----|------|------|------|-------|
| Labour, demo and haul away | 6 | hrs | $95.00 | $570.00 | Demolition and disposal |
| Disposal bin | | | | $220.00 | Demolition and disposal |
| Rough-in labour | 8 | hrs | $95.00 | $760.00 | Plumbing |
| Mixing valve | 1 | ea | $310.00 | $310.00 | Plumbing |
```

Customer grouped view would render:

```markdown
| Work package | Price |
|---|---|
| Demolition and disposal | $790.00 |
| Plumbing | $1,070.00 |
```

### 4.2 Compatibility, measured

**Confirmed by execution.** I compiled `lib/estimate-summary.ts` standalone and ran the current parser against format variants. Results:

| Variant | Items parsed | Subtotal | Verdict |
|---|---|---|---|
| Current 5-column | 2 | $435 | Baseline, correct |
| Group column **first** (6 col) | 3 | **$0** | **Catastrophic.** Header row parsed as a line item, all costs lost |
| Group column **last** (6 col) | 2 | $435 | **Safe.** Old parser ignores the extra cell, total correct |
| Legacy 2-column | 1 | $285 | Correct |

The "group first" failure happens because the header filter only skips rows whose first cell starts with "item" (`estimate-summary.ts:197`). A leading "Group" header defeats it.

**Confirmed:** a trailing group column is genuinely backward and forward compatible. Option A is not disqualified on compatibility. This is its strongest point.

### 4.3 The measured problem with markdown as storage

**Confirmed by execution.** The prompt explicitly forbids the model from emitting a Subtotal row in the Line Items table. Nothing enforces it. When I fed the parser a table containing a stray `| Subtotal | | | | $285.00 |` row:

- The parser accepted it as an ordinary line item.
- The subtotal became **$570 instead of $285, a 100% overcharge**, silently.

**Confirmed by execution, second defect.** The round trip is lossy. Parsing then re-serializing a document drops the `# ` H1 title line permanently, because `parseSummary()` filters H1 (line 152) and `serializeSummary()` never re-emits it. The first time a contractor edits any field, the stored H1 is gone. Totals were stable and the round trip was idempotent after that first save, and custom sections such as a `## Warranty` block did survive.

**Inference:** these are not hypothetical. They are the predictable result of a text format carrying arithmetic with no schema to reject malformed input. Adding a seventh meaning to the same table makes the surface larger.

### 4.4 Assessment

| Dimension | Assessment |
|---|---|
| Implementation complexity | Low. Extend `parseSummary`/`serializeSummary`, add a group field to `LineItem`, add a grouping branch to `formatEstimateForDisplay()`, add a mode toggle |
| Compatibility | Good, with a trailing column. Confirmed by measurement |
| Parsing reliability | Poor and worsening. No schema, no validation, three parsers |
| Editing reliability | Moderate. The editor already round-trips; a group field is another free-text cell to keep consistent across rows |
| Grouped calculations | Workable. Group totals sum `lineItemCost()` per group, so they equal detailed totals by construction |
| Malformed model output | **Confirmed real risk.** Group labels are free text; the model will produce near-duplicates ("Plumbing" vs "Plumbing fixtures") that fragment groups |
| Exact totals | Preserved, since totals stay code-computed |
| Detailed vs grouped | Supported |
| Approval snapshots | Weak. A snapshot would be a frozen markdown string; verifying that an approved total matches its line items means re-running a regex parser |
| Revisions | Weak. Diffing two markdown blobs to show what changed between revisions is painful |
| Invoice conversion | Weak. Roadmap Phase 3 wants invoice totals derived from line items and partial or deposit invoices; that means selecting subsets of rows, which means addressing rows, which markdown rows cannot do (they have no stable id) |
| Migrations | None required |
| Testability | Moderate. Pure functions are testable, but the input space is unbounded text |
| Rollback | Easy. Stop writing the column; old parsers ignore it |
| Overloaded format risk | **High. This is the core objection.** It makes `summary` carry grouping semantics on top of pricing, quantities, units, rates, tax rate, and deposit percent |

---

## 5. Option B: Structured line items

### 5.1 Reuse or replace `tpe_estimate_line_items`?

**Confirmed shape** from `lib/database.types.ts:137-196`:

`id`, `estimate_id` (FK), `pricebook_item_id` (FK), `name`, `description`, `quantity`, `labour_price`, `material_price`, `taxable`, `sort_order`, `created_at`, `updated_at`.

**Confirmed:** `CLAUDE.md` documents this table as `description, quantity, unit_price, line_type`. That is wrong on every column. The generated types are correct.

Sufficiency against the fields this feature needs:

| Needed | Present? |
|---|---|
| Description | Yes (`name` + `description`) |
| Group or work package | **No** |
| Quantity | Yes |
| Unit | **No** |
| Unit cost / rate | **No.** It has `labour_price` and `material_price`, not a rate |
| Labour hours | **No** |
| Labour rate | **No** |
| Markup | **No** |
| Taxability | Yes (`taxable`) |
| Customer visibility | **No** |
| Display order | Yes (`sort_order`) |
| Optional or allowance status | **No** |
| Internal vs customer-facing description | **No** |

**Confirmed conclusion: replace, do not reuse.** Beyond the eight missing fields, its money model actively conflicts with the shipped one. It splits each row into `labour_price` and `material_price`; the shipped model is one cost per row, either `quantity * rate` or a flat fee. Reusing it would force either a lossy mapping or a second contradictory pricing concept. It also carries a `taxable` flag the app has never honoured, since tax is applied to the whole subtotal.

**Recommendation:** treat `tpe_estimate_line_items` as abandoned. Do not write to it. Do not drop it in the same change that adds the replacement (dropping is irreversible and it is harmless where it sits); schedule removal separately once the new table is in production.

### 5.2 Minimum viable structured schema

**Recommendation.** Deliberately minimal: only what grouped pricing plus the two queued phases need. No speculative columns.

```
tpe_estimate_items
  id                    uuid pk
  estimate_id           uuid fk -> tpe_estimates(id) on delete cascade
  sort_order            int not null default 0
  label                 text not null        -- contractor-facing item name
  group_label           text                 -- work package, null = ungrouped
  kind                  text not null        -- 'quantity' | 'flat'
  quantity              numeric              -- null for flat
  unit                  text                 -- freeform: hrs, gal, sqft, ea
  unit_rate             numeric              -- null for flat
  amount                numeric not null     -- flat: typed; quantity: qty * rate, stored for auditability
  is_allowance          boolean not null default false
  customer_visible      boolean not null default true
  created_at, updated_at
```

Plus on `tpe_estimates`:

```
  pricing_source        text not null default 'markdown'  -- 'markdown' | 'structured'
  customer_pricing_mode text not null default 'detailed'  -- 'grouped' | 'detailed'. Correction 2026-07-31: the applied schema uses 'detailed', not 'grouped'. See TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md section 11.
```

Notes on the shape:

- `kind` makes explicit what `quantityBased` currently infers from cell emptiness. That inference is the source of the subtle bug documented at `estimate-summary.ts:69-88`.
- `amount` is stored even for quantity rows so an approved snapshot can be verified without recomputation, while `computeTotals` keeps recomputing for live estimates.
- No markup column. Markup is applied at generation time to material prices and is deliberately not shown to customers; storing it per row is a separate decision.
- No labour-hours column. Labour hours are just `quantity` with `unit = 'hrs'`.
- `customer_visible` and `is_allowance` are included because roadmap Phase 1 explicitly requires "small consumables should not appear individually" and "allowances must remain clearly labelled".
- `pricing_source` is the migration marker. It is what prevents dual ownership.

**Recommendation:** no `taxable` column for now. Tax is currently applied to the whole subtotal at one rate; adding per line taxability would be a product change nobody asked for.

### 5.3 Assessment

| Dimension | Assessment |
|---|---|
| Reuse vs replace | Replace. Confirmed insufficient and conflicting |
| Migration complexity | Moderate. One new table, two columns, one backfill function, plus a dual read path during transition |
| Source of truth | Clean. `pricing_source` decides per estimate, no ambiguity |
| Compatibility with existing markdown | Good, via lazy migration. Un-migrated estimates keep the current code path untouched |
| Generation pipeline | Moderate change. Parse the model's table once at save time into rows. The prompt does not change |
| Editor | Largest change. It currently holds one parsed document in state; it would hold rows plus prose. Its existing structure already separates line items from sections, so the seam exists |
| Totals | Improved. Sum a typed numeric column instead of regex-parsing money out of text |
| Grouped vs detailed | Native. `GROUP BY group_label`, or group in code |
| Approval snapshots | Strong. Snapshot rows plus rendered markdown; the approved total is verifiable against its own rows |
| Revisions | Strong. Row-level diffing is straightforward |
| Invoice conversion | Strong. Rows have stable ids, so deposit and partial invoices can reference item subsets |
| PDF and share page | Small change. Both consume `formatEstimateForDisplay()` output; that function's signature changes but its contract does not |
| Testing | Strong. Typed data, no unbounded text input |
| Rollback | Moderate. Flip `pricing_source` back to `markdown`. Requires keeping the markdown path alive during transition, which is the plan anyway |
| Partial migration or dual-write drift | **The main risk.** Mitigated by the rule in section 8: never dual-write |

---

## 6. Comparison table

Scored 1 to 5, higher is better.

| Criterion | A: markdown | B: structured | Note |
|---|---|---|---|
| Speed to implement | **5** | 2 | A is days, B is weeks. A needs no migration |
| Compatibility with existing data | **5** | 4 | A measured safe with a trailing column. B is safe via lazy migration but adds a code path |
| Data integrity | 1 | **5** | Measured: markdown silently turned $285 into $570 on one stray row. Typed columns cannot do that |
| Calculation reliability | 2 | **5** | Both recompute, but A recomputes from regex-extracted text, including tax rate and deposit percent parsed back out of rendered output |
| Editing reliability | 2 | **4** | A's round trip is measurably lossy (H1 dropped). B edits typed rows |
| Support for grouped pricing | 3 | **5** | A works but group labels are unconstrained free text that will fragment |
| Approvals and revisions | 1 | **5** | A snapshots an opaque string. B snapshots verifiable rows |
| Invoice conversion | 1 | **5** | Phase 3 needs addressable line items. Markdown rows have no stable identity |
| Maintainability | 1 | **4** | A adds a seventh meaning to one text column read by three independent parsers |
| Migration risk | **5** | 2 | A has none. B has real backfill and dual-path risk |
| **Raw total** | **26** | **41** | |

**Confirmed** the raw total is not the deciding argument, and per the task it should not be read as one. The weighting that matters: the four criteria where A scores 1 (data integrity, approvals and revisions, invoice conversion, maintainability) are exactly the long-term correctness criteria, and three of them are the next two roadmap phases. A wins only on speed and migration risk, both short-term.

---

## 7. Recommended architecture

**Recommendation: Option B, narrowly scoped.**

The scoping is what makes it tractable. **Do not migrate the whole document.** Migrate only the priced rows.

- **Structured**: line items, quantities, units, rates, amounts, group labels, allowance and visibility flags. Anything arithmetic or addressable.
- **Markdown, unchanged**: job summary, scope of work, assumptions and exclusions, payment terms, notes. Prose belongs in prose. Moving it would be the "overloaded format" mistake in reverse and buys nothing.
- **Derived, never stored as input**: the Pricing Summary table. It is already fully regenerated on every parse. Once items are structured, it is pure output.

This resolves the specific defect where `taxRate` and `depositPercent` are recovered by regex from previously rendered output. Under B those move to explicit fields on the estimate, read from `tpe_businesses` at creation.

---

## 8. Authoritative source-of-truth rule

**Recommendation. Stated so there is no dual ownership.**

1. **Pricing:** structured rows in `tpe_estimate_items` are authoritative for every estimate where `tpe_estimates.pricing_source = 'structured'`. For `pricing_source = 'markdown'` (all existing estimates until touched), the `## Line Items` markdown table remains authoritative, read by today's parser, unchanged.

2. **Prose:** `tpe_estimates.summary` is always authoritative for job summary, scope, assumptions and exclusions, payment terms, and notes. This never changes.

3. **Never both.** `pricing_source` is a one-way switch, flipped inside the same transaction as the backfill. **No dual writes, ever.** Once an estimate is `structured`, the `## Line Items` block in its `summary` is regenerated output only and is never read back. This is the single rule that prevents drift.

4. **After sending:** once immutable snapshots exist (roadmap Phase 2), the snapshot is authoritative for what that customer was shown, outranking both live rows and live markdown. Editing a sent estimate creates a revision; it does not mutate the snapshot.

**Confirmed** this leaves exactly one owner per concern at every point in an estimate's life.

---

## 9. Existing-estimate compatibility

**Recommendation.** The governing rule: **a previously sent customer estimate must never change because of this work.**

| Case | Behaviour |
|---|---|
| Old estimate, never opened again | Nothing happens. `pricing_source` stays `markdown`. Renders through today's code path, byte for byte identical |
| Old estimate, viewed by contractor | Read-only. No migration on read. Renders as today |
| Old estimate, edited by contractor | Backfilled to structured on first save, inside one transaction, then edited. Totals asserted equal before and after; if they differ the migration aborts and the estimate stays on the markdown path |
| Newly generated estimate | Written structured from the start. The model still emits the same markdown table; the save step parses it into rows once |
| Website quote request converted to draft | Same as newly generated. `buildDraftSummary()` output is parsed into rows at save |
| Copied estimate | Not applicable. **Confirmed** no duplicate or copy feature exists |
| PDF | Unchanged contract. Consumes `formatEstimateForDisplay()` output either way |
| Customer share page | Unchanged contract. Same function. Existing links keep resolving and keep showing the same numbers |
| Sent or archived estimate | **Never auto-migrated.** Excluded from lazy migration precisely because the share link is live and the customer may have the PDF |
| Future approval snapshots | Snapshot captures structured rows plus rendered markdown together, so an approved estimate is verifiable and immutable |

**Recommendation:** the grouped customer view ships **off by default for existing estimates** and on for newly created ones. A contractor who already sent a detailed estimate should not have the customer's view silently regroup on next open.

**Correction 2026-07-31:** the actual implementation sets `customer_pricing_mode = 'detailed'` for all estimates, including newly generated ones. The grouped view is not on by default for new estimates; it is enabled by the contractor-facing toggle, which is the next implementation slice. The recommendation above is preserved as the original design intent but was superseded by the implementation decision.

---

## 10. Migration strategy

**Recommendation.** Five slices, each independently shippable and reversible. No big bang.

1. **Schema only.** Create `tpe_estimate_items`, add `pricing_source` (default `'markdown'`) and `customer_pricing_mode` to `tpe_estimates`. Nothing reads or writes them. Zero behaviour change. Regenerate `lib/database.types.ts`.
2. **Backfill function, pure and tested.** `parseSummary` output to row objects, plus the inverse renderer that produces the identical `## Line Items` markdown from rows. Test the invariant: for a corpus of real stored summaries, `render(parse(md))` totals equal `calculateEstimateTotal(md)` exactly. Still nothing wired up.
3. **Write path.** New estimates save structured. Reads still go through markdown, which the write path also keeps producing. This is the one deliberate overlap window, and it is safe because markdown is still the only reader.
4. **Read path plus flip.** Reads honour `pricing_source`. Lazy backfill on edit for non-sent estimates. Markdown line items become derived output for structured estimates.
5. **Grouping UI.** Only now: `group_label` editing, the grouped customer renderer, and the mode toggle. This is the first slice a user can see.

**Recommendation:** slices 1 and 2 carry essentially no risk and are the correct next work. The decision to proceed past slice 3 can be re-taken after slice 2 proves the totals invariant against real data.

---

## 11. Failure modes

| Failure | Likelihood | Mitigation |
|---|---|---|
| Backfill changes a total | Medium | Slice 2's invariant test. Abort migration per estimate on mismatch and leave it on the markdown path |
| Dual-write drift | **High if allowed** | Structurally prevented: `pricing_source` is one-way and there is never a period where both are read |
| Partial migration leaves a mixed estate | High, and expected | This is the designed steady state, not a failure. Both paths are supported indefinitely |
| Group labels fragment ("Plumbing" vs "Plumbing fixtures") | High | Constrain to a picklist per estimate derived from existing labels, plus free text. Applies to Option A equally, but B can enforce it |
| Sent estimate changes for the customer | Low | Sent estimates are excluded from lazy migration entirely |
| The three parsers disagree | Medium | B reduces this: PDF and share page keep consuming one generated string |
| Editor regression | Medium | Largest code change. Ship behind slice ordering, keep the markdown editor path alive |
| Scope creep into full document migration | Medium | Explicitly out of scope. Prose stays markdown |

---

## 12. Testing strategy

**Recommendation.**

- **Invariant, highest value:** for every existing stored summary, parse to rows, render back, and assert `calculateEstimateTotal` is unchanged. Run over a real corpus before slice 3.
- **Property test:** group totals sum exactly to the detailed subtotal, for arbitrary groupings including ungrouped and single-group.
- **Golden files:** a set of real summaries (5-column, legacy 2-column, with a stray Subtotal row, with a custom section) each with expected parsed rows and totals. Locks in the currently measured behaviour before it is changed.
- **Regression:** the malformed-input cases measured in section 4, so the structured path is proved to reject what the markdown path silently accepted.
- **Rendering:** share page and PDF render the same numbers in both modes and for both `pricing_source` values.

**Confirmed constraint:** the existing Playwright suite defaults to production and creates real Stripe customers, so these should be pure unit tests, not smoke tests. The pattern from `tests/smoke/pro-payments-entitlement.spec.ts` (pure, no network) is the right model.

---

## 13. Rollback strategy

**Recommendation.** Per slice:

- Slices 1 and 2: nothing to roll back, nothing is wired up.
- Slice 3: stop writing rows. Markdown is still authoritative and complete.
- Slice 4: set `pricing_source = 'markdown'` for affected estimates. The markdown line-item block was kept in sync as generated output, so it is current and correct. **This is why slice 3 keeps writing markdown.**
- Slice 5: hide the grouping UI; `group_label` becomes inert data.

The new table is never dropped as part of a rollback.

---

## 14. Consequences for approval and invoicing

**Inference, and the main reason for the recommendation.**

- **Approval (Phase 2)** requires storing "the estimate version approved" and proving later which version that was. Under A that is an opaque markdown string whose total can only be re-derived by regex. Under B a snapshot has rows and a stored `amount`, so an approved total is verifiable arithmetic.
- **Invoice conversion (Phase 3)** requires copying "selected customer-facing line items" and supporting deposit, progress, and final invoices. That means addressing and subsetting individual items. Markdown rows have no stable identity; structured rows have `id`. Under A, Phase 3 would need to invent row identity anyway, which is Option B arriving late and under pressure.
- **Confirmed current state:** `invoice_amount` is a single number typed by the contractor, pre-filled from the estimate total and never reconciled against line items. B is what makes reconciliation possible.

**Inference:** choosing A now most likely means doing B later anyway, with two migrations instead of one and a live approval feature depending on the format being changed.

---

## 15. Explicitly rejected alternatives

1. **Option A, extended markdown.** Rejected. Viable and cheap, measured compatible with a trailing column, but scores 1 of 5 on data integrity, approvals and revisions, invoice conversion, and maintainability. It deepens a format that was measured silently doubling a subtotal and losing the title on first edit.
2. **Reusing `tpe_estimate_line_items` as-is.** Rejected. Missing eight required fields and its `labour_price`/`material_price` split contradicts the shipped `quantity * rate` model.
3. **Migrating the entire document to structured storage** (scope, assumptions, and terms as rows). Rejected as unnecessary complexity. Prose has no integrity problem.
4. **Dual-write, both representations authoritative.** Rejected. Guaranteed drift, and explicitly forbidden by the decision constraints.
5. **Big-bang backfill of every estimate.** Rejected. Would touch sent estimates whose share links are live and whose PDFs are already in customers' hands.
6. **Grouping computed at render time by an AI call.** Rejected. Non-deterministic, cannot guarantee group totals equal detailed totals, adds latency and cost to the share page.
7. **Storing group labels only, in a side table, leaving items in markdown.** Rejected. Requires stable row identity in markdown, which does not exist, so it is Option B with worse ergonomics.

---

## 16. Exact next implementation slice

**Recommendation: slice 2, the pure backfill and render functions, with the totals invariant test. Do slice 1 alongside it only if schema access is convenient.**

Deliberately starting at slice 2 rather than slice 1, because slice 2 needs no schema access, no migration, and no production contact, and it is what actually de-risks the decision. It answers the one question that could still invalidate this architecture: does every real stored estimate round-trip through structured rows without changing a total?

Concretely, in a new `lib/estimate-items.ts`:

- `parsedToItems(parsed: ParsedSummary): EstimateItemDraft[]`
- `itemsToLineItemsBlock(items): string`, producing markdown byte-identical to today's `lineItemsBlock()`
- A pure test asserting, for a golden corpus, that totals are unchanged in both directions.

No schema change, no route change, no UI change, nothing wired into the app.

---

## 17. Unknowns requiring confirmation

- **Unknown:** indexes and RLS policies on `tpe_estimate_line_items` and what RLS the new table needs. No migrations directory in the repo. Must be checked in Supabase before slice 1.
- **Unknown:** how many stored estimates exist and their format mix (5-column, legacy 2-column, malformed). This determines backfill risk and is needed for the slice 2 corpus. Requires a read-only production query.
- **Unknown:** whether any stored estimate already carries a corrupted total from the stray-Subtotal-row class of defect. Worth a read-only audit query before backfill, since backfill would otherwise faithfully preserve a wrong number.
- **Unknown, product:** whether the model should choose group labels at generation time or the contractor assigns them. This affects the prompt, not the storage model, so it does not block this decision.
- **Unknown, product:** whether `customer_pricing_mode` should default to grouped for brand-new estimates only, or be a business-level preference. Section 9 recommends the former.
- **Inference not yet proved:** that the editor can hold rows plus prose without a rewrite. Its existing separation of line items from sections suggests yes, but this is the largest code change and has not been prototyped.
