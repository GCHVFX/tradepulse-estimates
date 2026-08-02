## Source of Truth

This roadmap describes the intended product direction.

Current implementation always takes precedence.

Before implementing any roadmap item:

1. Read HANDOFF.md.
2. Read TRADEPULSE_ESTIMATES_BASELINE.md, the verified Phase 0 audit of what is actually built.
3. Inspect the existing implementation.
4. Verify the feature does not already exist.
5. Update this roadmap if implementation has already reached the planned phase.

This document is not an implementation checklist.

Where this roadmap and `TRADEPULSE_ESTIMATES_BASELINE.md` disagree, the baseline wins: it was verified against the code and the generated database types on 2026-07-30.

# TradePulse Estimates Product Roadmap and Specification

**Status:** Draft for product planning  
**Date:** 2026-07-30  
**Primary pricing decision:** Keep Starter at **$39 CAD/month**  
**Primary product goal:** Make TradePulse the fastest way for a contractor to create, send, approve, and convert a professional estimate without rebuilding the job in another system.

---

## 1. Decision

TradePulse should keep the existing pricing structure:

- **Starter: $39 CAD/month**
  - TradePulse Estimates
- **Pro: $69 CAD/month**
  - Estimates
  - Reviews (built)
  - Payments (built)
  - Follow-Up (not built yet, see Phase 6)

Do not lower the permanent Starter price to compete with low-cost estimating apps.

TradePulse already supports user-defined labour rates and line items. The next work should not duplicate that capability. The priority is to complete the estimate workflow after sending and improve how pricing is presented to customers.

A temporary founding-user offer may be used for customer acquisition, but it should be framed as an early-user discount rather than the true product value.

---

## 2. Product Position

### Core promise

> Create a professional estimate in seconds, send it from your phone, and move the job forward without retyping anything.

### Competitive position

TradePulse should not try to match SimplyWise feature for feature.

TradePulse should win on:

1. Faster estimate creation
2. Less pre-generation friction
3. Better contractor-written scope
4. Cleaner customer presentation
5. SMS and email delivery
6. Approval and next-step workflow
7. Estimate-to-invoice continuity
8. Reviews and payment follow-up through the wider TradePulse platform

### Product boundary

TradePulse is not a bookkeeping toolbox.

Do not add:

- Receipt scanning
- Mileage tracking
- Generic business utilities
- Project icons
- Complex dashboards
- Long mandatory setup flows
- Mandatory multi-question estimate interviews

---

## 3. Current Product Baseline

The following capabilities already exist and must be preserved:

- Job description input
- Voice input
- Photo input
- Customer name, phone, email, and address
- User-defined labour rate
- User-defined and reusable line items
- Generated scope of work
- Detailed labour and material calculations
- Assumptions and exclusions
- Pricing summary
- Payment terms
- Shareable customer estimate
- PDF download
- SMS delivery
- Email delivery
- Estimate-sent confirmation
- Mark Job Done action
- Reviews workflow, already built inside TradePulse Estimates itself (Pro-gated, `MarkJobDoneSheet` plus `POST /api/estimates/[id]/review-request`), not in a separate product
- Partial invoicing, already built as the Pro-gated Payments feature: mark a done estimate as invoiced (`PATCH /api/estimates/[id]/invoice`), mark paid (`PATCH /api/estimates/[id]/mark-paid`), automated payment reminders via a daily cron, and the `/payments` list. `tpe_estimates` already carries `payment_status`, `invoice_amount`, `due_date`, `last_reminder_sent_at`, and `reminder_count`.
- Estimate photo storage, already built as the `tpe_estimate_photos` table plus `POST`/`DELETE /api/estimates/[id]/photos` and the `tpe-estimate-photos` bucket

Do not rebuild or duplicate these capabilities.

### Repository reconciliation note

Added 2026-07-30 while filing this roadmap into the repository. The four bullets above marked as already built were verified against the current code and generated Supabase types. Phases 3 and 5 must extend these existing implementations rather than build parallel ones. Nothing else in this roadmap was found to describe an existing capability as missing.

---

## 4. Main Product Problems to Solve

### Problem A: The workflow stops after sending

The customer can view the estimate, but there is no complete acceptance workflow.

**Required outcome:** The customer can approve the estimate, and the contractor can see that approval immediately.

### Problem B: The same job must be rebuilt for invoicing

The estimate already contains customer data, scope, line items, pricing, and terms.

**Required outcome:** The contractor can convert an approved estimate into an invoice without re-entering job details.

**Correction, 2026-07-30:** this problem is partially solved already. The Pro-gated Payments feature lets a contractor mark a done estimate as invoiced with an amount and due date, and it reuses the estimate's customer data rather than asking for it again. What is genuinely missing is invoicing driven by customer approval, invoice totals derived from the estimate's own line items instead of a single typed amount, and partial or deposit invoices. Phase 3 should be read as extending Payments, not replacing it.

### Problem C: Customer pricing is too granular

The current estimate exposes a long list of small material items. The detail may be useful internally, but it makes the customer-facing estimate harder to scan.

**Required outcome:** Keep detailed costing available to the contractor while showing customers a clean work-package breakdown by default.

### Problem D: Estimate status is not clear enough

Actions such as Send Estimate and Mark Job Done can appear in ways that do not clearly communicate the job state.

**Required outcome:** The available primary action must follow the current estimate state.

### Problem E: Photos do not yet carry through the complete workflow

Photo capture exists, but the customer estimate should support optional job photos where they help explain scope.

**Required outcome:** Contractors can choose which photos appear on the customer estimate.

**Correction, 2026-07-30 (Phase 0 audit):** this is mostly solved already. `tpe_estimates.include_photos` plus the toggle in `app/components/estimate-photos.tsx` already lets a contractor decide whether photos appear, and `app/share/[id]/page.tsx` and the PDF both honour it. What is genuinely missing is per-photo selection rather than all-or-nothing, plus captions, ordering, photo roles, and metadata stripping. See section 7 of `TRADEPULSE_ESTIMATES_BASELINE.md`.

---

## 5. Roadmap

## Phase 0: Baseline Audit and Scope Lock

**Status: COMPLETE, 2026-07-30.** Delivered as `TRADEPULSE_ESTIMATES_BASELINE.md` in the project root. That document, not this section, is the source of truth for what is currently built.

**Priority:** Immediate  
**Purpose:** Confirm current behaviour before changing it.

### Work

- Document the current estimate state model.
- Confirm how labour rates and saved line items affect generated pricing.
- Confirm existing photo storage and attachment behaviour.
- Confirm PDF, SMS, email, and share-link behaviour.
- Confirm what Mark Job Done triggers.
- Record current estimate page and customer share-page performance.
- Identify any conflict between current implementation and this specification.

### Deliverable

A short implementation note containing:

- Existing database tables and status fields
- Current estimate lifecycle
- Existing send channels
- Existing pricing flow
- Current photo flow
- Known gaps and regressions

### Exit criteria

- No existing feature is mistakenly rebuilt.
- The current source of truth is recorded in `HANDOFF.md`.
- The next phase can be implemented without guessing about existing behaviour.

---

## Phase 1: Customer-Friendly Pricing Presentation

**Priority:** Highest  
**Purpose:** Improve estimate readability without removing contractor detail.

### Contractor view

The contractor may see:

- Individual labour line items
- Individual material line items
- Quantities
- Unit costs
- Labour hours
- Labour rate
- Markup
- Internal subtotal calculations

### Customer view

Default to grouped work packages, for example:

- Demolition and disposal
- Plumbing fixtures and installation
- Electrical and ventilation
- Flooring
- Vanity, countertop, and finish carpentry
- Painting and finishing

Each group shows:

- Short description
- Group price

The customer view also shows:

- Subtotal
- Tax
- Total
- Deposit, when applicable
- Payment terms
- Assumptions and exclusions

### Interaction

Add a customer-facing pricing mode to the estimate editor:

- **Grouped pricing**: Default
- **Detailed pricing**: Optional

The contractor chooses the mode before sending. The last-used preference may be remembered.

### Storage model: DECIDED 2026-07-30

The precondition raised by the Phase 0 audit is resolved. Full analysis in `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md`; the decision is recorded in `DECISIONS.md`.

**Line items move to structured storage. Prose stays markdown.** A new table (working name `tpe_estimate_items`) holds label, group label, kind, quantity, unit, unit rate, amount, allowance flag, customer-visible flag, and sort order. Job summary, scope, assumptions and exclusions, payment terms, and notes stay in `tpe_estimates.summary`.

**Source of truth:** structured rows are authoritative for pricing where `tpe_estimates.pricing_source = 'structured'`, markdown where it is `'markdown'`. One-way flip, no dual writes, no window where both are read.

**Existing estimates:** default to `'markdown'` and render exactly as today. Backfill is lazy, per estimate, on first edit, and aborts if a total would change. **Sent estimates are never auto-migrated.** Grouped view is off by default for existing estimates, on for new ones. **Correction 2026-07-31:** the actual implementation sets `customer_pricing_mode = 'detailed'` for all estimates, including newly generated ones. Grouped view is not on by default for new estimates; it is enabled by the contractor-facing toggle, which is the next implementation slice.

**`tpe_estimate_line_items` is replaced, not reused.** It is missing eight required fields and its `labour_price`/`material_price` split contradicts the shipped `quantity * rate` model. It stays in the schema unwritten until the replacement ships.

Implementation is sliced into five independently shippable steps; see section 10 of the architecture document. `formatEstimateForDisplay()` in `lib/estimate-summary.ts` remains the correct seam, since the share page and PDF both already render through it.

**Implementation status as of 2026-08-02:** Slices 1 (schema), 2 (conversion function and totals invariant), 3 (write path for new estimates via `/api/generate-estimate`), and 5 (shared read path, grouping UI, persisted contractor toggle, share page, and PDF for newly generated structured estimates) are complete on `main`, not pushed. Detailed remains the default. Slice 4's historical lazy-backfill exposure is deliberately incomplete and was not part of the customer-facing toggle task, so all historical markdown estimates remain unchanged. The next implementation slice is customer approval and change requests backed by immutable estimate snapshots.

### Rules

- Do not delete or discard internal line-item data.
- Group totals must exactly match the detailed totals.
- The PDF, share page, SMS link, and email link must show the same selected pricing mode.
- Small consumables should not appear individually in grouped mode.
- Allowances must remain clearly labelled.
- Tax calculations must remain unchanged.

### Acceptance criteria

- A customer can understand the work and total without reading a shopping list.
- Internal and customer totals match exactly.
- The contractor can switch to detailed pricing when needed.
- Existing saved estimates render correctly.

---

## Phase 2: Approval and Signature

**Priority:** Highest  
**Purpose:** Turn sent estimates into recorded decisions.

### Customer experience

At the bottom of a sent estimate, show:

- **Approve Estimate**
- **Request a Change**

Approval flow:

1. Customer selects **Approve Estimate**
2. Customer confirms full name and email or phone
3. Customer signs or checks an approval confirmation
4. Customer submits approval
5. Confirmation screen states that the estimate was approved

Request-change flow:

1. Customer selects **Request a Change**
2. Customer enters a short message
3. Contractor is notified
4. Estimate status changes to **Change Requested**

### Contractor experience

Estimate statuses:

- Draft
- Sent
- Viewed
- Change Requested
- Approved
- Declined
- Converted to Invoice
- Job Done

**Correction, 2026-07-30:** the shipped status values are `draft`, `sent`, `done`, and `needs_review`. `needs_review` is not cosmetic: combined with `source = 'website_quote'` it marks an inbound website quote request, and `app/components/estimate-actions.tsx`, `app/estimates/page.tsx`, and `app/estimates/[id]/page.tsx` all branch on it. Any new status model must preserve that behaviour, and `done` is the existing spelling of Job Done.

The estimate screen should display:

- Current status
- Date and time of last status change
- Customer approval details
- Approval signature, when used
- Change request message, when present

### Notifications

Send the contractor an immediate notification when:

- Estimate is viewed for the first time
- Estimate is approved
- Customer requests a change

Use in-app notification first. Email or SMS notification can be configurable later.

### Dependency on the Phase 1 storage decision (added 2026-07-30)

This phase depends on Phase 1's structured line items. An approval snapshot must capture the structured rows alongside the rendered markdown, so that an approved total is verifiable arithmetic against its own line items rather than a number re-derived by regex from an opaque string. Do not build approval on top of a markdown-only estimate. See `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md` sections 8 and 14.

Once snapshots exist, the snapshot is authoritative for what a given customer was shown, outranking both the live rows and the live markdown.

### Legal and record requirements

Store:

- Estimate version approved
- Approval timestamp
- Customer name
- Customer email or phone
- Signature or explicit approval record
- IP address and user agent where legally appropriate
- Full estimate snapshot at approval time

Do not allow later estimate edits to alter the approved snapshot.

### Acceptance criteria

- Customer approval takes no more than two decisions after opening the estimate.
- Contractor can prove which version was approved.
- Approved estimate PDF includes approval information.
- Editing an approved estimate requires creating a revision.
- A revised estimate receives a new approval state.

---

## Phase 3: Estimate-to-Invoice Conversion

**Priority:** Highest  
**Purpose:** Remove duplicate entry and connect quoting to payment.

### Entry point

When an estimate is approved, make the primary action:

**Create Invoice**

Allow manual conversion before approval only through a secondary action with a confirmation warning.

### Conversion behaviour

Copy:

- Customer
- Job address
- Estimate number reference
- Scope title
- Selected customer-facing line items
- Subtotal
- Tax
- Total
- Deposit paid or due
- Payment terms
- Notes relevant to invoicing

Do not copy:

- Internal-only cost calculations
- Hidden markup data
- Internal notes
- Removed or optional estimate items not accepted by the customer

### Dependency on the Phase 1 storage decision (added 2026-07-30)

"Selected customer-facing line items" and the deposit, progress, and final invoice options below all require addressing and subsetting individual line items. Markdown rows have no stable identity, so this phase depends on Phase 1's structured rows, which do have an `id`. Note the current shipped behaviour for contrast: `invoice_amount` is a single number typed by the contractor, pre-filled from the estimate total and never reconciled against line items. Structured storage is what makes reconciliation possible.

### Invoice editing

Before creating the invoice, allow:

- Progress invoice amount
- Deposit invoice
- Final invoice
- Full estimate total
- Due date
- Payment terms
- Optional note

### Status connection

After conversion:

- Estimate status becomes **Converted to Invoice**
- Invoice links back to the source estimate
- Estimate links to the invoice
- Later payment status must not overwrite the approved estimate record

### Acceptance criteria

- An approved estimate can become an invoice in under 30 seconds.
- No customer or job information must be retyped.
- Totals remain accurate.
- Partial and deposit invoices are supported.
- Source estimate and invoice remain linked.

---

## Phase 4: Estimate State and Primary-Action Cleanup

**Priority:** High  
**Purpose:** Make the next step obvious at every stage.

### Primary action by state

| Estimate state | Primary action |
|---|---|
| Draft | Send Estimate |
| Sent | View Customer Version |
| Viewed | Follow Up |
| Change Requested | Review Changes |
| Approved | Create Invoice |
| Converted to Invoice | View Invoice |
| Job Done | Request Review |

### Mark Job Done rule

Do not show **Mark Job Done** as the dominant action before the estimate has been sent or approved unless the contractor explicitly bypasses the normal workflow.

Recommended rule:

- Hide before sending.
- Show as secondary after sending.
- Show more prominently after approval or invoice creation.
- After Job Done, offer the Reviews workflow.

### Acceptance criteria

- Each state has one obvious primary action.
- The user never sees mutually conflicting primary actions.
- Back navigation does not reset estimate status.
- Send confirmation returns the user to the correct state.

---

## Phase 5: Photos on Customer Estimates

**Priority:** Medium, and smaller than written. **Correction, 2026-07-30 (Phase 0 audit):** the estimate-level version of this phase already ships. Photos upload to `tpe_estimate_photos` via `POST /api/estimates/[id]/photos` (Pro-gated), the contractor toggles `include_photos`, and the share page and PDF both render them behind that flag. Only per-photo control remains: `visibility`, `display_order`, `caption`, and the photo roles below do not exist as columns. Also note the confirmed bug in section 13 of the baseline: photo deletion is currently broken because the client sends `{ url }` where the route expects `{ storage_path }`.

**Purpose:** Improve clarity and professionalism for visual jobs.

### Contractor controls

For each photo:

- Internal only
- Include with estimate
- Cover photo
- Before photo
- Scope reference

### Customer display

- Show a compact gallery after the job summary or scope.
- Limit the default estimate view to selected photos.
- Compress images for mobile.
- Preserve full-resolution originals privately.

### Rules

- Photos are optional.
- Do not force photos into every estimate.
- Do not expose unselected jobsite photos.
- Remove location metadata from shared copies where practical.
- Customer-visible photos must be included in the approved estimate snapshot.

### Acceptance criteria

- Contractor can select customer-visible photos in one tap.
- Shared estimate loads quickly on mobile.
- Photos appear consistently in web and PDF outputs.

---

## Phase 6: Follow-Up After Sending

**Priority:** Medium  
**Purpose:** Improve conversion without turning TradePulse into a CRM.

### Default workflow

After an estimate is sent:

- Day 0: Estimate delivered
- Day 3: Optional polite follow-up
- Day 7: Optional second follow-up
- Stop automatically when approved, declined, or change requested

### Contractor controls

- Follow up automatically
- Remind me to follow up
- No follow-up

### Message rules

- Short
- Specific to the estimate
- No aggressive sales language
- Include direct estimate link
- Stop after customer response

### Acceptance criteria

- No follow-up is sent after approval or decline.
- Contractor can disable follow-up per estimate.
- Follow-up status is visible without a complex dashboard.

---

## Phase 7: Remote Photo Request

**Priority:** Later  
**Purpose:** Let contractors gather enough information to quote without a first visit.

### Workflow

1. Contractor selects **Request Job Photos**
2. TradePulse creates a secure customer link
3. Customer adds:
   - Photos
   - Short description
   - Address
   - Contact information
4. Contractor receives a notification
5. Submitted information can start a new estimate

### Constraints

- Keep the customer form short.
- Do not require account creation.
- Do not promise that a site visit is unnecessary.
- Contractor decides whether the information is sufficient.

### Acceptance criteria

- Customer submission takes less than three minutes.
- Photos and answers attach to the correct customer and estimate.
- Contractor can generate an estimate directly from the submission.

---

## Phase 8: Trade-Specific Measurement Tools

**Priority:** Optional, after core workflow  
**Purpose:** Add measurable value for selected trades without bloating the product.

Potential tools:

- Room dimensions for painting
- Wall and ceiling area
- Flooring area
- Baseboard length
- Simple opening deductions

### Build rule

Only build this if user evidence shows that measurement is a meaningful reason to choose or retain TradePulse.

Do not build LiDAR or 3D room scanning as an early priority. Start with simple dimensions and calculations using manual entry or existing device capabilities.

### Acceptance criteria

- Tool saves more time than it adds.
- Results feed directly into estimate quantities.
- Tool remains optional and hidden for unrelated trades.

---

## 6. Estimate Output Specification

## Customer-Facing Estimate

### Required sections

1. Company header
2. Estimate title and number
3. Customer and job information
4. Job summary
5. Scope of work
6. Optional selected photos
7. Pricing
8. Assumptions and exclusions
9. Payment terms
10. Estimate validity
11. Approve or Request a Change actions

### Length target

The estimate may be detailed, but it must remain scannable.

Recommended limits:

- Job summary: 2 to 3 sentences
- Scope groups: 3 to 7 groups
- Scope bullets: 2 to 6 bullets per group
- Assumptions and exclusions: only job-relevant items
- Customer pricing: 3 to 8 grouped price lines by default
- Payment terms: 2 to 4 short lines

### Content rules

- Do not repeat the original user prompt in Notes.
- Do not include instructions such as “Create a professional estimate.”
- Do not expose every minor material by default.
- Do not use vague filler.
- Do not make code-compliance claims unless the scope supports them.
- Flag unknown site conditions clearly.
- Keep internal markup hidden.
- Label allowances clearly.
- Use Canadian spelling.
- Do not use em dashes.

## Contractor Internal View

May include:

- Labour hours
- Labour rate
- Materials and quantities
- Unit costs
- Markup
- Internal notes
- Confidence warnings
- Saved line-item source
- Generated assumptions
- Customer-visible grouping

Internal details must never leak into customer output unless the contractor chooses detailed pricing.

---

## 7. Estimate Generation Rules

The generator must use, in order:

1. User-defined saved line items
2. User-defined labour rate
3. User pricing and markup preferences
4. Relevant trade template
5. Prior accepted edits, when implemented
6. Model-generated assumptions only when no user source exists

### Confidence handling

When a key price or quantity is uncertain:

- Flag it internally
- Use an allowance where appropriate
- Add a relevant assumption or exclusion
- Do not present invented precision as verified pricing

### Follow-up questions

Do not force a long questionnaire before generation.

Generate first when possible.

After generation, surface only high-impact questions such as:

- Who supplies the fixture?
- Is the existing subfloor damaged?
- Is vent relocation required?
- Is the customer choosing standard or premium materials?

The contractor can answer these to regenerate or update the estimate.

---

## 8. Data Model Requirements

Exact schema should follow the existing project structure. Do not create duplicate tables without reviewing current Supabase tables.

Required concepts:

### Estimate

- id
- business_id (corrected 2026-07-30: `tpe_estimates` links to `tpe_businesses.id` via `business_id`, not to `auth.users` via a `user_id` column. Ownership resolves through `tpe_businesses.owner_user_id`.)
- customer_id
- status
- version
- title
- summary
- scope
- pricing_mode
- subtotal
- tax
- total
- created_at
- sent_at
- viewed_at
- approved_at
- converted_at
- job_done_at

**Correction, 2026-07-30 (Phase 0 audit).** Against the current schema:

- `scope` already exists as a column but is **unused**; scope text lives inside `summary`. The same is true of `assumptions`, `payment_terms`, and `notes`.
- `subtotal`, `tax`, and `total` do **not** exist as columns and are computed on demand by `computeTotals()` from the parsed line items. Adding them means deciding whether stored totals or computed totals win.
- `version`, `pricing_mode`, `viewed_at`, `approved_at`, and `converted_at` do not exist.
- `job_done_at` does not exist; the shipped field is `completed_at`, which is currently **overwritten** by the mark-paid route, destroying the job completion time. Fix that before relying on it.
- The shipped payment fields are `payment_status`, `invoice_amount`, `due_date`, `reminder_count`, and `last_reminder_sent_at`, all on `tpe_estimates`.

### Estimate version snapshot

- estimate_id
- version
- complete customer-visible content
- complete pricing
- PDF or render reference
- created_at

### Approval

- estimate_id
- estimate_version
- customer_name
- customer_contact
- approval_type
- signature_reference
- approved_at
- request metadata

### Change request

- estimate_id
- estimate_version
- message
- submitted_at
- resolved_at

### Invoice relationship

- estimate_id
- invoice_id
- conversion_type
- converted_at

### Photos

- estimate_id
- storage_reference
- visibility
- display_order
- caption

Note, 2026-07-30: `tpe_estimate_photos` already exists and already covers `estimate_id` and `storage_path` (plus `original_filename`, `mime_type`, `file_size`). Only `visibility`, `display_order`, and `caption` are actually new. Extend the existing table rather than adding a second photo table.

---

## 9. Analytics and Success Metrics

Do not build a complex dashboard. Record the events needed to judge product value.

### Activation

- First estimate generated
- First estimate sent
- Time from account creation to first sent estimate

### Speed

- Time from starting description to generated estimate
- Time from generated estimate to sent estimate
- Number of edits before sending

### Quality

- Percentage of generated line items retained
- Percentage of estimates sent without major rewrite
- Contractor corrections to labour and material pricing
- Estimates switched from detailed to grouped pricing

### Conversion

- Estimates viewed
- Estimates approved
- Change requests
- Estimate-to-invoice conversions
- Time from sent to approved

### Retention

- Contractors creating a second estimate
- Estimates created per active user
- Monthly active estimating users
- Cancellation reason

### Pricing validation

The $39 price is supported when users consistently:

- Send a real estimate during their first session
- Save at least 20 minutes per estimate
- Create multiple estimates per month
- Use approval or invoice conversion
- Report that the estimate requires only minor edits

---

## 10. Pricing Rollout

### Standard pricing

- Starter: $39 CAD/month
- Pro: $69 CAD/month

### Optional founding offer

Example:

- $24 CAD/month locked for the first 25 to 50 paying users
- Available only during the early validation period
- Clearly labelled as founding pricing
- Standard price shown as $39 CAD/month

### Do not

- Permanently lower Starter to $10 to $20
- Add multiple confusing estimate tiers
- Charge separately for every core estimate feature
- Hide pricing behind a sales call
- Add per-user pricing before team features exist

---

## 11. Priority Summary

### Build now

1. Baseline audit and source-of-truth update
2. Customer-friendly grouped pricing
3. Approval and signature
4. Estimate-to-invoice conversion
5. Estimate state and primary-action cleanup

### Build next

6. Customer-visible photos
7. Estimate follow-up
8. Remote photo request

### Consider later

9. Simple trade-specific measurement tools
10. Renders
11. Good / Better / Best packages

### Do not build

- Receipt scanner
- Mileage tracker
- Generic small-business suite
- Mandatory questionnaire
- Full CRM
- Complex dashboard
- LiDAR room scanning before core workflow validation

---

## 12. Implementation Sequence

Each phase should be completed and verified before starting the next.

For every phase:

1. Read `HANDOFF.md`
2. Inspect the current implementation
3. Confirm affected files and schema
4. Implement only the requested phase
5. Preserve unrelated behaviour
6. Add or update tests
7. Run typecheck, lint, tests, and production build
8. Test the full workflow on mobile
9. Update `HANDOFF.md`
10. Report:
   - Files changed
   - Schema changes
   - Behaviour changed
   - Verification run
   - Known limitations
   - Exact next action

---

## 13. Definition of Success

This roadmap succeeds when a contractor can:

1. Describe a job
2. Generate a credible estimate
3. Review a clean customer-facing version
4. Send it by SMS or email
5. Receive customer approval
6. Convert it to an invoice
7. Mark the job done
8. Trigger payment and review workflows

The product must accomplish this without turning into a large field-service management system.
