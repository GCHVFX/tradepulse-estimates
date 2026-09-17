# Spec: Contractor-owned pricing (Phase 1)

**Status:** Slices 1 to 4, and slice 5's customer-output half (section 11: classification-driven
customer document, the share-page "not ready" gate), are implemented and committed locally on
`phase1-contractor-pricing`, unpushed and not deployed. Slice 5's delivery-locking half (sections 12
and 13) is implemented but uncommitted: completeness gating on PATCH /api/estimates, send-sms and
send-email; the customer-document lock on PATCH and on the photo routes; the copy-link ordering fix.
The constraint migration is applied to live Supabase (2026-09-15), as is the slice 2 snapshot and
save-function migration. HANDOFF.md carries the per-slice detail.
**Supersedes:** the AI-authored pricing model audited at commit `4dae358`.
**Prerequisite:** the tax hotfix (Appendix A) ships and is verified first, as a separate change.
**Authority:** this file is the authoritative Phase 1 pricing specification. The root `SPEC.md` is an
unrelated marketing-site redesign spec and has nothing to do with pricing.

---

## What this is

TradePulse currently lets the AI write the labour hours, the labour rate, the material prices, the line
item prices and the tax rate. The app then does arithmetic on top of numbers nobody can account for. This
change removes that. The AI writes the words. The contractor types two numbers. TradePulse does the maths.

The rule every decision below is tested against:

> **AI may interpret, structure and write the estimate. It must never author a number that changes the
> selling price.**

Or, shorter, for arguing with during implementation:

> **AI writes the job. The contractor owns the price. TradePulse owns the maths.**

---

## Verified production state (2026-09-15)

| Source / pricing_source / status | Count |
|---|---|
| `ai_generated` / `markdown` / `draft` | 6 |
| `ai_generated` / `structured` / `draft` | 3 |
| `ai_generated` / `structured` / `sent` | 2 |
| `ai_generated` / `structured` / `done` | 2 |

- 4 estimates have `sent_at`. 0 have `copied_at`.
- 3 of the delivered estimates are Circuit & Co test estimates from 2026-09-14. The 2026-09-11 estimate is
  the external one and is the critical preservation baseline.
- Production contains only `source='ai_generated'`. Zero `website_quote` rows exist yet.
- The 2026-09-11 estimate has quantity-based rows, including labour hours times rate. Its stored `summary`
  is therefore not equivalent to what the customer sees; the customer-facing rendering collapses those
  rows.

---

## Resolved decisions

### 1. Structured data becomes the source of truth

Pricing inputs live in `tpe_estimate_items`. Generated markdown becomes prose only. No price-driving value
is ever parsed back out of text for a new estimate.

The customer-facing pricing block is rendered from the calculation at display time and is never stored as
an authoritative figure.

### 2. Estimate classification

Ordered rules, evaluated top down. Fail-safe: anything unrecognised is legacy.

1. `pricing_source = 'contractor_pricing'` → new authoritative pricing model
2. `source = 'website_quote'` AND `status = 'needs_review'` → unpriced inbound intake
3. everything else → **legacy, read-only**

Do not classify on `pricing_source` alone, on `source` alone, or on `sent_at`. Do not enumerate historical
source values; rule 3 catches anything unanticipated.

Three existing sites branch on the literal `'structured'` and must be moved onto this classification or
they will mis-handle a `contractor_pricing` estimate: the `structuredPricing` prop in
`app/estimates/[id]/page.tsx`, the sync-plan branch in `app/api/estimates/route.ts`, and the
`.eq("pricing_source", "structured")` guard in `app/api/estimates/[id]/pricing-mode/route.ts`.

The database default for `pricing_source` stays `markdown`. Clearwater inserts without a `pricing_source`,
and an inbound quote has no contractor-authored price, so it must never default into `contractor_pricing`.

### 3. Migration

Already applied to live Supabase on 2026-09-15, and committed as a migration file so local and CI match
production:

```sql
alter table tpe_estimates
  drop constraint if exists tpe_estimates_pricing_source_valid;

alter table tpe_estimates
  add constraint tpe_estimates_pricing_source_valid
  check (pricing_source in ('markdown', 'structured', 'contractor_pricing'));
```

The live constraint is named `tpe_estimates_pricing_source_valid`, not `..._check`.

Every estimate this app creates sets `pricing_source = 'contractor_pricing'` explicitly in the insert, and
sets `source` and `status` explicitly rather than relying on the column defaults (`source` defaults to
`'website_quote'` and `status` to `'needs_review'`). The generation insert at
`app/api/generate-estimate/route.ts` currently sets neither `pricing_source` nor the snapshots; without
this it defaults to `'markdown'` and every new estimate classifies as legacy under section 2 rule 3.

Still to add, nullable, populated from `tpe_businesses` at estimate creation (or at first pricing save for
inbound quotes, see section 15):

- `deposit_percent_snapshot numeric`
- `deposit_threshold_snapshot numeric`
- `tax_rate_snapshot numeric`
- `tax_label_snapshot text`

These exist because a later change to Rates must not alter an estimate that already went to a customer.
The existing `tpe_estimates.currency` snapshot is the pattern to copy. The legacy `[deposit-rule]` marker
inside markdown is not used by new estimates.

Do not add `labour_hours`, `labour_rate` or `markup_percent` to the items table. They already exist, they
are redundant with `quantity`/`unit_price`, and they stay null and unused.

`tpe_estimate_items.item_type` already permits `labour`, `material`, `service`, `allowance` and `other`.

### 4. Pricing input encoding

Every pricing input is a row in `tpe_estimate_items`. The AI never writes to this table.

| Input | `item_type` | `quantity` | `unit` | `unit_price` |
|---|---|---|---|---|
| Hourly labour | `labour` | hours | `hr` | rate |
| Fixed labour | `labour` | 1 | null | amount |
| Materials | `material` | 1 | null | cost (pre-markup) |
| Optional charge | `other` | 1 | null | amount |

Hourly versus fixed labour is determined by `unit = 'hr'`. State this rule in code comments at both the
write and the read site.

`description` is NOT NULL and carries a not-blank CHECK (`tpe_estimate_items_description_not_blank`), so
every row needs one. Labour rows are written as `Labour` and material rows as `Materials`, both fixed
strings. A charge row takes the contractor's own text, which is required: a blank charge description is
rejected, never defaulted.

`quantity`, `unit_price` and `line_total` are NOT NULL, which gives the blank/zero encoding for free:

- **No row** = unknown. Blocks delivery.
- **Row with amount 0** = the contractor deliberately entered zero. Valid.

Gating checks for row presence, not for a value greater than zero, with the one hourly-rate exception in
section 8.

`line_total` is written only by the calculation module and never read back as authority for anything.

### 5. Labour input

One labour input per estimate. No task decomposition, no multiple labour rows.

Two methods, chosen per estimate, not per business:

- **Hourly:** hours times rate.
- **Fixed:** a single labour amount. No rate involved.

No default-method setting in the profile. The method is whichever field the contractor fills in.

`tpe_businesses.labour_rate` is NOT NULL with a default of 0, so a null rate is not a state that exists.
Treat a stored rate of `0` as not configured.

Rate behaviour:

- Hourly labour always shows its rate, pre-filled from the business rate when that is greater than zero.
- **Business rate is 0:** the rate field is empty and blocking. It must accept a value greater than zero.
  The first valid rate is written to both `tpe_businesses.labour_rate` and this estimate, by the pricing
  save route in section 12 and never by `PATCH /api/price-book` (see section 11).
- **Business rate already set:** the contractor may override it on this estimate. That override applies to
  this estimate only and does not change the business default. Changing the default stays a Rates action.
- A genuinely free labour line is expressed as **fixed labour = $0**, which remains valid.

### 6. Materials input

The contractor enters **material cost**, pre-markup. TradePulse applies markup deterministically.

The customer-facing figure is rendered live beneath the input, always:

```
Materials (your cost)     $ 1,150.00
Customer sees $1,380.00 · 20% markup           [Change]
```

`markup_percent` is NOT NULL with a default of 0, so the database cannot distinguish "never configured"
from "deliberately zero". Do not claim it was never set. At 0 the line reads
`Customer sees $1,150.00 · 0% markup`.

- The applied percentage is displayed on every editable estimate, including 0%.
- It can be changed for the current estimate.
- The applied percentage is stored on the material row (`tpe_estimate_items.markup_percent`).
- An estimate-specific markup change is **not** written back to the business default.

### 7. Optional charges

Zero or more rows: a description and an amount. Disposal, permits, equipment, subcontractors, allowances.

Never required. Never counted toward the two-input limit. Hidden behind an "Add charge" control, following
the existing progressive-disclosure rule. No picking from saved charges, no categories, no quantity times
unit.

### 8. One calculation module

A single pure, isomorphic module in `lib/`. Inputs: the item rows plus the estimate snapshots. Output:
every figure, plus the list of missing or invalid required inputs.

```
labour     = round_cents(hours × rate)   (unit='hr')
           | amount                      (unit=null)
materials  = round_cents(cost × (1 + markup/100))
charges    = Σ charge amounts
subtotal   = labour + materials + charges
tax        = round_cents(subtotal × tax_rate_snapshot / 100)
total      = subtotal + tax

deposit:
  if deposit_percent_snapshot is null
  OR deposit_threshold_snapshot is null
  OR deposit_percent_snapshot <= 0
  OR deposit_threshold_snapshot <= 0:
      deposit = 0
  else if total > deposit_threshold_snapshot:
      deposit = round_cents(total × deposit_percent_snapshot / 100)
  else:
      deposit = 0

balance    = total − deposit
```

**Completeness output** must flag all three of:

- labour row absent
- materials row absent
- hourly labour row (`unit='hr'`) with rate <= 0

Fixed labour of $0 is complete and valid.

**Null checks are explicit.** Both deposit columns are genuinely nullable and 13 of 14 current businesses
have both null, so zero-deposit is the common path, not an edge case. Never rely on JavaScript coercion or
comparison against null.

A `deposit_threshold` of 0 means **no deposit rule is active**, preserving current behaviour. Known
limitation: a contractor who wants a deposit on every job cannot express that in Phase 1.

For a `contractor_pricing` estimate, a **null tax snapshot is an incomplete pricing state**, not 0%. An
inbound `website_quote` may hold null snapshots until the contractor starts pricing it.

**Rounding, in one place only.** Integer cents are the calculation module's internal representation only.
`tpe_estimate_items.quantity`, `unit_price` and `line_total` are `numeric` with no fixed scale and store
dollars, exactly as the existing rows do; convert at the module boundary and never persist cents. Then:
contractor-entered money converts to integer cents on input; hourly
labour rounds to cents; marked-up materials round to cents; optional charges are already cents; subtotal is
the sum of those rounded components; tax, deposit and balance round to cents. No surface implements its own
rounding. The deposit threshold is stored in dollars, so convert it to cents before comparing it with a
total held in cents.

Every consumer imports this same module: the editor's live totals, `loadCustomerPricingView`, the share
page, the PDF string, the send routes, the invoice prefill. There must be no second implementation of this
arithmetic for new estimates when this change lands.

Nothing derived is ever persisted: no subtotal, tax, total, deposit or balance columns, and none of those
figures stored inside `summary` as authoritative text.

### 9. Generation changes

Strip every number-producing instruction from the system prompt and user message in
`app/api/generate-estimate/route.ts`. The model receives no labour rate, no markup, no price-book prices,
no tax rate, no deposit rule. It also receives no contractor-entered amounts, because it will repeat them
in prose.

The model returns prose sections only: job title, summary paragraph, Scope of Work, Assumptions and
Exclusions, Payment Terms (with no deposit sentence), Notes. No Line Items table. No Pricing Summary. No
"Estimated total" line.

Keep the prompt line added by the tax hotfix: *"Never write currency amounts, prices, rates, or
percentages of cost. Refer to the Pricing section instead."*

### 10. Prose validation

Server-side, after the stream completes, before insert, at the point `applyDeterministicDeposit` runs
today:

- Scan prose sections for currency figures: `$`, `CA$`, `US$`, and a number followed by "dollars".
- Also scan for any sentence containing "deposit".
- Delete the matching sentence, following the existing `normalizePaymentTermsDeposit` precedent. Log a
  count.
- Do not retry the model. Do not block the save.

Deleting the sentence is correct and must not be softened into a warning banner. When the model writes
"includes a $500 allowance for unforeseen repairs", it is trying to create a charge, and the contractor now
has a real place to put one.

Contractor-typed prose is not validated. Those figures are traceable to the contractor.

### 11. Customer-facing output

Scope of Work stays descriptive prose with no prices. Priced scope rows disappear entirely.

The customer sees prices only at the level the contractor entered them:

```
Labour                           $760.00
Materials                      $1,380.00
Permit                           $150.00
─────────────────────────────────────────
Subtotal                       $2,290.00
GST 5%                           $114.50
Total                          $2,404.50
Deposit required                 $721.35
Balance on completion          $1,683.15
```

Labour renders as a single amount. Hours and rate are visible to the contractor while editing and are
**not** shown to the customer. A per-estimate toggle for time-and-material shops is deferred.

**Tax label and rate are visible and editable in the contractor's pricing block.**
`tpe_businesses.tax_rate` is NOT NULL and defaults to 5, so without this a contractor outside a 5% province
ships a wrong tax line and never sees where it came from. Unlike labour rate and markup, editing tax writes
to **both** this estimate's snapshot and the business default: tax is a jurisdiction setting, not a per-job
decision. The snapshot still prevents a later change from altering this estimate.

**The estimate editor never calls `PATCH /api/price-book`.** The pricing save route in section 12 owns
every business-default write that estimate editing needs, in the same transaction as the pricing rows:

- Business `labour_rate` is 0 and the contractor supplies the first valid hourly rate: update
  `tpe_businesses.labour_rate`.
- The contractor changes the tax label or rate: update this estimate's tax snapshots **and**
  `tpe_businesses.tax_label` / `tax_rate`.
- A per-estimate labour-rate override when a business rate already exists changes this estimate only.
- A per-estimate markup change changes this estimate only.

`PATCH /api/price-book` stays the Rates form's endpoint and is not repurposed for estimate editing.

> **IMPLEMENTATION NOTE:** `PATCH /api/price-book` is unsafe for partial callers because omitted
> `labour_rate`, `markup_percent`, `deposit_percent` and `deposit_threshold` values are currently coerced
> to 0. Do not reuse it for estimate-side partial updates or other new partial-write flows unless that
> route is explicitly changed to preserve omitted fields.

Phase 1 replaces the tax hotfix's display-only treatment (plain text plus a "Set in Rates" link) with this
editable control.

One customer format in Phase 1. Grouped mode, `group_label`, `assignGroupLabel` and
`renderGroupedLineItemsBlock` are obsolete for new estimates.

### 12. Editing, regenerate and locking

- `/new` displays and edits the **saved record**, not the raw stream buffer. Once the estimate id arrives,
  load the saved estimate. This is the root cause of F1 and it does not fix itself.
- The editor edits item rows directly. It never receives a rendered pricing block to parse. The
  `detailedSummary` handoff at `estimate-pricing-editor.tsx` must not survive. This is what fixes F2.

**Regenerate** replaces prose on the existing estimate id. Pricing rows, snapshots, customer data and
photos survive. No new row is inserted and no orphan is left behind.

Show one confirmation before regenerating any undelivered `contractor_pricing` estimate:

> Regenerate replaces the current job wording. Your pricing will stay the same.

No edit-history detection, no merging, no versioning. Delivered estimates cannot regenerate.

**Delivered** is the shared `isDelivered()` predicate introduced by the tax hotfix
(`lib/estimate-delivery.ts`): `sent_at IS NOT NULL OR copied_at IS NOT NULL OR status IN ('sent','done')`.
SMS, email and copy link are all ways of putting the estimate in front of a customer. Phase 1 uses that same
predicate; it must not grow a second definition.

**The authoritative pricing write path is `PUT /api/estimates/[id]/pricing`.** It does not exist yet: the
only current writer of `tpe_estimate_items` is the markdown-driven sync plan in
`app/api/estimates/route.ts`, which this change deletes. One route owns contractor pricing input. Its
payload is semantic, not rows:

- `labour`: absent or null; hourly (hours plus rate); or fixed (amount)
- `materials`: absent or null; or cost plus `markup_percent`
- `charges`: zero or more description plus amount rows
- `tax`: the current label and rate, when changed

The route converts that payload into the canonical `tpe_estimate_items` rows defined in section 4, using
the fixed `Labour` and `Materials` descriptions and rejecting a blank charge description.

Rules:

- An incomplete `contractor_pricing` draft can be saved. The route derives and returns completeness, but
  incompleteness never rejects a save. Completeness rejects delivery only (section 13).
- It rejects every pricing write once `isDelivered()` is true.
- On the first pricing save for `website_quote` intake, the same transaction copies the tax and deposit
  snapshots from the business, sets `pricing_source='contractor_pricing'`, moves `status` from
  `needs_review` to `draft`, and writes the pricing rows.
- The row replacement, any promotion, the snapshot copies and the business-default writes from section 11
  are atomic. A partially replaced pricing state must not be possible.

The editor calls only this route for pricing. Prose edits continue through `PATCH /api/estimates` and
carry no pricing.

Locked once delivered, enforced **server-side at every mutation route that can change them**, including the
pricing-row write path:

- pricing rows
- generated and edited prose
- customer-facing customer details
- `include_photos`, and photo add/delete (`POST`/`DELETE /api/estimates/[id]/photos`), which change the
  customer's page after delivery
- currency
- tax snapshots
- deposit snapshots
- regenerate

**Not locked**, because they do not rewrite the customer document: Mark Job Done and status progression
after delivery; the invoice and payment workflow; payment reminders; review requests; resending the
existing immutable estimate; copying the existing immutable link again.

### 13. Delivery gating

An estimate with a missing or invalid required input cannot reach a customer by any route.

**Client:** Send, Resend and Copy link disabled from the shared completeness check, naming which input is
missing. Extend the existing `isZeroTotal` hook at `estimate-actions.tsx` and add the same check to the
`/new` Send button.

**Server:**
- `send-sms` and `send-email` return 409 when incomplete.
- `PATCH /api/estimates` refuses `status='sent'` or `copied_at` while incomplete.
- `/share/[id]` renders "estimate not ready" instead of pricing when incomplete. This covers the PDF, which
  is only reachable from the share page.

**Classification runs before the completeness check** on the share page and in the send routes. A legacy
estimate has no pricing rows, so a completeness check evaluated first would wrongly block every legacy
share link, including the 2026-09-11 estimate. Legacy delivered estimates cannot be resent.

**Copy link order is fixed and must not be reordered:**

1. Confirmation: *"This sends the estimate. You won't be able to change it after."*
2. Server-side completeness check and delivery PATCH.
3. Only after the PATCH succeeds, copy the customer URL to the clipboard.

The current implementation writes to the clipboard first and then sends the PATCH, so this is a real
reorder, not a restatement. If the server refuses delivery, nothing reaches the clipboard. If the clipboard
write itself fails after the estimate is locked, report the copy failure and let the contractor retry
copying the already-delivered immutable link. Do not unlock the estimate.

Do not build a separate non-locking preview in Phase 1.

### 14. Legacy estimates

Legacy is anything caught by rule 3 of section 2.

**The stored `summary` string is not sufficient to reproduce what a legacy customer sees.** The 2026-09-11
estimate has quantity-based rows and its customer-facing rendering collapses them (for example into
"Labour (8 hrs @ $65.00/hr)"). Rendering the raw stored text would change that document.

So Phase 1 keeps a **frozen legacy display path**: the minimum of the current parser and formatter needed
to reproduce the existing customer-facing representation, unchanged.

Requirements on that path:

- Explicitly named and isolated as legacy compatibility code, so it cannot drift into being a second source
  of truth.
- Read-only. No pricing edits, no prose edits, no sending.
- No new estimate may call the legacy parser or formatter.
- No legacy value may feed any new pricing calculation.
- Quantity-row collapsing and customer-facing formatting stay exactly as they are today.

No backfill. No conversion. No repricing. This is permanent for the nine drafts that exist at cutover: six
`markdown` and three `structured`, all undelivered. Once Phase 1 lands they can be read and deleted but
never priced or sent, and the contractor recreates any of them that still matter rather than converting
them. Legacy drafts open and show:

> This estimate was created with the previous pricing system and is read-only. Create a new estimate to
> change or send it.

This path also **replaces the tax hotfix's delivered-estimate carve-out**. Removing that carve-out is part
of this change, not optional. A new `contractor_pricing` estimate stores prose-only `summary`, so a generic
"if delivered, render the stored summary" rule would strip the pricing block off every new delivered
estimate.

### 15. Clearwater intake

`GCHVFX/clearwater-plumbing` `app/api/quote/route.ts` inserts into `tpe_estimates` with
`source='website_quote'`, `status='needs_review'` and no `pricing_source`. **That repo is not touched by
this change and must keep working unmodified.**

In this repo:

- The `pricing_source` default stays `markdown`. The constraint must not break inserts that omit the column.
- An inbound quote is unpriced intake, not legacy, per section 2.
- Keep the existing inbound quote prose path (`buildDraftSummary`). Remove its price-book prices, its `$0`
  Pricing Summary and every other pricing output. Do **not** reroute website quotes through the main AI
  generation endpoint.
- **Promotion on first pricing save:** when the contractor first saves any pricing on an inbound quote, copy
  the tax and deposit snapshots from the business, set `pricing_source='contractor_pricing'`, and move
  `status` from `needs_review` to `draft`. This happens even if only one of the two required inputs has been
  entered. An incomplete `contractor_pricing` draft is valid internally and simply cannot be delivered.
- **"Create Estimate" must stop flipping the status on its own.** `handleCreateEstimate` in
  `app/components/estimate-actions.tsx` currently PATCHes `status: "draft"` while `pricing_source` is still
  `markdown`, which matches neither rule 1 nor rule 2 and strands the quote as legacy before it can be
  priced. The status move belongs only to the promotion step above.

There are currently zero `website_quote` rows in production.

---

## Delete, do not harden

For new estimates, remove all dependency on:

- `parseSummary`'s money paths: line items, tax rate, deposit percent, deposit rule
- `computeTotals` over parsed line items, `applyDeterministicDeposit`, `syncPreambleTotal`,
  `lineItemsBlock`, `pricingBlock` as storage
- The `[deposit-rule]` marker
- `convertEstimateToStructuredItems` and `buildStructuredItemsSyncPlan`
- The editor's inline duplicate arithmetic and its markdown line-item editing
- `assignGroupLabel` and `renderGroupedLineItemsBlock`
- Price-book pricing in `buildDraftSummary`
- The "Estimated total" prompt instruction and its preamble handling

**Survives, frozen:** whatever subset of the parser and formatter section 14 needs to reproduce legacy
customer rendering. Name it as legacy compatibility code. Nothing new calls it.

**Stop calling, but do not drop:** the RPC `tpe_convert_estimate_to_structured`. Remove every call site.
Leave the database function in place.

---

## Explicitly out of scope

Anything on this list that appears in the implementation is scope creep and should be rejected on sight.

- Task-level labour, a task library, per-task standards, labour units, production rates
- Saved contractor standards and similar-job retrieval (Phase 2 and Phase 3)
- A material database, material line pricing, vendor lookups, automatic material pricing
- Reference or benchmark labour times from any source
- Time tracking or actual-versus-estimated hours
- Multi-option estimates (Good/Better/Best). Not supported today, not built now.
- Grouped and detailed customer pricing modes, group labels, work packages
- Any algorithm that allocates labour or materials across scope lines
- Revision or version management for delivered estimates
- Converting, repricing or backfilling legacy estimates
- Unifying the inbound quote prose path with the main generation endpoint
- A non-locking customer preview
- A deposit rule that applies to every job regardless of total
- Photo-derived quantity suggestions pre-filling pricing inputs
- Re-syncing `invoice_amount` after an edit
- A default labour-method setting in the business profile
- Dropping unused database functions or columns
- Validating contractor-typed prose

---

## Acceptance tests

Add to `tests/smoke/`, following existing conventions there (env-var credentials, established `baseURL`).
Each is one assertion on one previously broken behaviour.

**Cost and account rules:**

- Do not create fresh live accounts or make real AI calls for every test. Use existing controlled smoke
  fixtures and direct DB or API setup wherever practical.
- Where a test genuinely needs a fresh signup, use the existing `signUpFreshAccount()` helper, because of
  the live Stripe-key rule.
- Only `pricing-ai-authors-no-numbers` should require the real generation path.
- Tests must not send real SMS or email. Use copy link, which is a status change with no outbound message,
  as the delivery action wherever a test needs a delivered estimate.
- During implementation, run focused tests for the files changed. Run broader verification at the final
  checkpoint only.
- Every new spec file must be registered, or `unit-suite-completeness.spec.ts` fails: add it to
  `playwright.unit.config.ts`'s `testMatch` if it is unit-safe, or to that spec's
  `CANNOT_RUN_IN_UNIT_CONFIG` map with a stated reason longer than 40 characters. All 11 tests below need
  live accounts and a browser, so all 11 need exclusion entries.
- `tests/smoke/helpers.ts` has no estimate-creating helper, only `signUpFreshAccount`, `loginAs`,
  `cleanupTestAccount`, `expireTrial` and `resetSignupRateLimit`. Estimates and their pricing rows have to
  be seeded with direct service-role inserts.

```ts
// tests/smoke/pricing-ai-authors-no-numbers.spec.ts
test("generated estimate contains no currency figures before contractor input", async ({ page }) => {});

// tests/smoke/pricing-blank-labour-blocks-send.spec.ts
test("estimate with no labour row cannot be sent", async ({ page }) => {});

// tests/smoke/pricing-zero-labour-is-valid.spec.ts
test("explicit zero fixed labour delivers successfully", async ({ page }) => {});

// tests/smoke/pricing-unset-labour-rate-blocks-hourly.spec.ts
test("hourly labour with a rate of 0 blocks delivery until a real rate is entered", async ({ page }) => {});

// tests/smoke/pricing-new-edit-uses-saved-record.spec.ts     (F1)
test("editing on /new does not restore server-removed prose or wipe deposit terms", async ({ page }) => {});

// tests/smoke/pricing-edit-does-not-flatten-labour.spec.ts   (F2)
test("editing keeps hours and rate in step with the labour total", async ({ page }) => {});

// tests/smoke/pricing-totals-match-across-surfaces.spec.ts
test("editor, share page and PDF show the same total for the same estimate", async ({ page }) => {});

// tests/smoke/pricing-copy-link-locks-before-clipboard.spec.ts
test("copy link locks server-side before the URL reaches the clipboard, and an incomplete estimate copies nothing", async ({ page }) => {});

// tests/smoke/pricing-delivered-estimate-is-locked.spec.ts
test("a delivered estimate cannot be repriced but can still be marked done and invoiced", async ({ page }) => {});

// tests/smoke/pricing-legacy-renders-unchanged.spec.ts
test("a legacy estimate renders its original collapsed quantity rows and offers no editing", async ({ page }) => {});

// tests/smoke/pricing-new-delivered-estimate-keeps-pricing-block.spec.ts
test("a delivered contractor_pricing estimate still renders its calculated pricing block", async ({ page }) => {});
```

---

## Implementation notes

Carried from the 2026-09-15 grill pass against the code at `3073774`. Facts about the current codebase a
build agent needs, not new architecture.

1. **Photo routes have no delivery check.** `POST` and `DELETE` in
   `app/api/estimates/[id]/photos/route.ts` check Pro and ownership only, and `include_photos` is a plain
   PATCH from `app/components/estimate-photos.tsx`. All three need the section 12 lock.
2. **Send routes bypass `PATCH /api/estimates`.** `app/api/send-sms/route.ts` and
   `app/api/send-email/route.ts` set `status` and `sent_at` with their own `supabaseAdmin.update`, so
   section 13's 409 must live in those routes. The PATCH guard alone catches only copy link.
3. **Section 12's currency lock is a no-op.** No route mutates `tpe_estimates.currency`;
   `estimateCurrencyPatch` in `lib/currency-db.ts` is insert-only. Nothing to build.
4. **The completeness hook's data source disappears.** `isZeroTotal` in
   `app/components/estimate-actions.tsx` is fed by an `estimate-total-change` window event dispatched from
   `app/components/editable-estimate-body.tsx`, which Phase 1 replaces. The replacement editor either keeps
   emitting that event or the hook is re-sourced.
5. **The legacy path still needs Appendix A's tax resolution.** Section 14 removes the delivered carve-out,
   but legacy estimates have no snapshots, so `resolveEstimateTax` with a stored authority must survive for
   them. Do not delete `lib/estimate-tax.ts` when deleting the markdown money paths.
6. **No test helper creates an estimate.** See the acceptance-test notes above.
7. **Schema facts that already hold**, verified against the live database: the `item_type` CHECK permits
   all four encodings; `quantity`, `unit_price` and `line_total` are NOT NULL; the `estimate_id` foreign key
   cascades on delete; `markup_percent` is nullable with a 0 to 1000 range; the `pricing_source` constraint
   already allows `contractor_pricing`.

---

## Open questions

None. If implementation surfaces a decision that is not in this document, stop and raise it rather than
choosing a plausible answer.

---

## Appendix A: tax hotfix (shipped separately, 2026-09-15)

Implemented before Phase 1 and deliberately disposable. Most of the code it touches is removed or frozen by
Phase 1.

1. Tax comes from `tpe_businesses.tax_label` / `tax_rate` for every undelivered estimate. The
   parse-from-summary-text path is no longer an authority.
2. The hard-coded 5% in the parser and the `taxRate = 5` default in `computeTotals` are gone, along with the
   editor's `|| 'GST'` and the route's `?? 5` / `?? 'GST'`. `tpe_businesses.tax_rate` is itself NOT NULL with
   a default of 5, so Rates remains the single authority; what was removed is a second, hidden default that
   could disagree with it.
3. The tax instruction and the `Tax (TAX_LABEL TAX_RATE%)` template row are gone from the generation prompt.
4. Every `parsed.taxRate` consumer takes the resolved tax instead: the editor, the customer pricing view,
   share and PDF rendering, conversion validation, and the deterministic deposit calculation.
5. `lib/estimate-delivery.ts` provides the shared `isDelivered()` rule, and every delivered-versus-undelivered
   decision in the hotfix uses it.
6. Delivered estimates keep rendering their own stored tax row, so the document a customer already holds
   cannot move. A delivered estimate renders even when its business row cannot be read; an undelivered one
   fails rather than pricing against a guessed tax.
7. The editor shows the tax as plain text plus a "Set in Rates" link. Section 11 replaces this with an
   editable control backed by the per-estimate snapshot.

**Known gap that Phase 1 closes:** a draft created before the hotfix keeps whatever tax the model wrote once
it is delivered, because delivered estimates read their stored text. Every business in production is GST 5%
and every stored row says GST 5%, so this has no current effect. The per-estimate tax snapshot removes it.
