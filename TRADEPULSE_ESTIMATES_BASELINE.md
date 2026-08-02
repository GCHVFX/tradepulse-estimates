# TradePulse Estimates Verified Baseline

Phase 0 deliverable for `TRADEPULSE_ESTIMATES_ROADMAP.md`.

## 1. Audit date

2026-07-30. Branch `main`, at commit `2906fcc` ("Cap Starter AI photo estimates at 3/calendar month, Pro unlimited"). No application code was changed by this audit.

## 2. Audit scope

The estimate lifecycle, pricing and line items, photos, delivery channels (PDF, SMS, email, share link), Mark Job Done and reviews, payments and invoicing, and a practical performance and rendering check of the estimate editor and customer share page.

Out of scope: auth, billing/Stripe, onboarding, SEO pages, the price book UI beyond its data contract, and the separate `/api/estimates/[id]/analyze-photos` inbound-quote route except where it touches the lifecycle.

Every claim below is labelled:

- **Confirmed** means read directly in the current source or generated types.
- **Inference** means reasoned from confirmed code but not executed or observed.
- **Unknown** means not verified in this audit.

## 3. Verification sources

- `lib/database.types.ts` (generated from the live schema) for all field names and nullability
- Route handlers under `app/api/`
- Server components `app/estimates/[id]/page.tsx`, `app/share/[id]/page.tsx`, `app/payments/page.tsx`
- Client components under `app/components/`
- `lib/estimate-summary.ts`, `lib/generate-pdf.ts`, `lib/audit-log.ts`, `lib/quote-templates.ts`
- `tests/smoke/` (read only, not executed, see section 11)
- Commands run: `npx tsc --noEmit`, `npx eslint`, `npx next build`, plus a local dev server loading public routes only

There is no `supabase/` directory and no migration files in the repository. **Confirmed:** schema is managed outside this repo, so `lib/database.types.ts` is the only in-repo schema source of truth.

## 4. Current estimate lifecycle

**Confirmed:** there is no single unified status model. State is spread across four independent fields on `tpe_estimates`, plus a fifth for reviews. They are not mutually exclusive and nothing enforces ordering between them.

### 4.1 `status` (text, contractor-facing)

Four values are used in code. **Confirmed** by exhaustive grep; the column is plain `string` in the generated types, so the database does not constrain it.

| Value | Set where | Triggered by | UI shown | Facing |
|---|---|---|---|---|
| `needs_review` | Not set by any app route. Arrives with `source = 'website_quote'` from an external inbound path. | Inbound website quote request | "Website Quote Request" badge, raw customer request text, `service_type`/`location`/`urgency` chips, primary action "Create Estimate" | Contractor |
| `draft` | `PATCH /api/estimates` from `EstimateActions.handleCreateEstimate()` ([estimate-actions.tsx:211](app/components/estimate-actions.tsx:211)); also the default for a newly generated estimate | Generating an estimate, or converting a quote request | Full editable estimate card, primary action "Send Estimate" | Contractor |
| `sent` | `POST /api/send-sms` ([route.ts:138](app/api/send-sms/route.ts:138)) and `POST /api/send-email`, alongside `sent_via` and `sent_at`. Also set by the copy-link path via `PATCH /api/estimates`. | Sending or copying the link | "Mark Job Done" (Pro only) plus "Send Estimate" again | Contractor |
| `done` | `PATCH /api/estimates` from `handleMarkDone()` ([estimate-actions.tsx:143](app/components/estimate-actions.tsx:143)), with `completed_at` | Mark Job Done button | Green "Job Done" panel, review request block, "Send Payment Reminder" | Contractor |

**Confirmed:** there is no `viewed`, `approved`, `declined`, `change_requested`, or `converted_to_invoice` state. Nothing records that a customer opened the share page.

### 4.2 `payment_status` (text, nullable, separate field)

**Confirmed:** `null` (never invoiced), `"unpaid"` (set by `PATCH /api/estimates/[id]/invoice`), `"paid"` (set by `PATCH /api/estimates/[id]/mark-paid`). Independent of `status`.

### 4.3 Timestamps

**Confirmed:** `sent_at`, `copied_at`, `completed_at`, `review_requested_at`, `last_reminder_sent_at`, `due_date`, `created_at`, `updated_at`.

**Confirmed defect, FIXED 2026-07-30:** `completed_at` was written by two unrelated actions. `handleMarkDone()` sets it to mean "job finished", and `mark-paid` overwrote it to mean "invoice paid", silently losing the job completion time. `mark-paid` now writes payment state only, so `completed_at` has a single owner. See section 13, item 10.

### 4.4 `include_photos` (boolean)

**Confirmed:** controls whether photos render on the customer share page and in the PDF. Toggled from the contractor estimate view. See section 7.

### 4.5 Audit log

**Confirmed:** `lib/audit-log.ts logEstimateChange()` writes to `tpe_estimate_changes`, but it is called from exactly two places: `send-sms/route.ts:156` and `send-email/route.ts:150`, both with `change_type: "sent"`. Creation, edits, status changes, invoicing, and deletion are **not** logged. `CLAUDE.md` implies all four change types are in use; only `sent` is.

## 5. Labour rates and saved line items

### 5.1 Storage

**Confirmed:** business-level pricing lives in columns on `tpe_businesses`, not a separate table: `labour_rate`, `markup_percent`, `deposit_percent`, `deposit_threshold`, `tax_label`, `tax_rate`. Read and written by `GET`/`PATCH /api/price-book` ([route.ts](app/api/price-book/route.ts)).

**Confirmed:** saved line items live in `tpe_pricebook_items` with `name`, `description`, `labour_price`, `material_price`, `category`, `business_id`. `GET /api/price-book` maps `labour_price` to the response key `unit_price` and returns `material_price` separately.

### 5.2 How they reach a generated estimate

**Confirmed, and this is the single most important finding for Phase 1:** pricing is applied by **natural-language instruction to the model**, not by deterministic calculation. `app/api/generate-estimate/route.ts:144-166` appends plain-English lines to the user message:

- `labour_rate` becomes "Labour rate: $X/hr. Use this rate for all labour line items"
- `markup_percent` becomes "Materials markup: X%. Apply this markup on top of all material costs"
- price book items become a list of "name: $labour_price" pairs, "use these prices when applicable"
- `tax_label`/`tax_rate` become a tax instruction
- `deposit_percent` + `deposit_threshold` become a conditional deposit rule

**Confirmed:** only `labour_price` is sent to the model. `material_price` and `description` from `tpe_pricebook_items` are stored and returned by the API but never injected into generation.

**Inference:** because markup and the labour rate are model instructions rather than code, there is no guarantee the generated numbers actually honour them, and no stored record of which price book item produced which line.

### 5.3 Where line items actually live

**Confirmed:** `tpe_estimate_line_items` exists in the schema and in the generated types, with a `pricebook_item_id` foreign key, but **no application code reads or writes it**. The only references outside the generated types are test-teardown deletes in `tests/smoke/helpers.ts:167`. It is dead.

**Confirmed:** the real storage for line items is the `summary` markdown column. `lib/estimate-summary.ts parseSummary()` parses `## Line Items` pipe tables into `LineItem[]`, and `serializeSummary()` writes them back. Two on-disk shapes are supported: a five-column structured table (`Item | Qty | Unit | Rate | Cost`) and a legacy two-column table (`Item | Cost`).

### 5.4 Totals

**Confirmed:** totals are recomputed in code, not trusted from the model. `computeTotals()` ([estimate-summary.ts:130](lib/estimate-summary.ts:130)) sums `lineItemCost()` for the subtotal, then `tax = round(subtotal * taxRate/100)`, `total = subtotal + tax`. `lineItemCost()` returns `quantity * rate` for quantity-based items and the typed cost for flat fees. `calculateEstimateTotal()` is what drives the "add pricing before sending" guard.

**Confirmed:** `depositPercent` and `taxRate` are parsed back **out of the rendered markdown** by regex ([estimate-summary.ts:229-235](lib/estimate-summary.ts:229)), not read from `tpe_businesses` at display time. The deposit amount is `round(total * depositPercent / 100)`.

**Confirmed:** markup is not applied anywhere in code. It exists only as the prompt instruction in 5.2, meaning it is already baked into whatever material prices the model wrote.

### 5.5 Defaults and fallbacks

**Confirmed:** `taxLabel` defaults to `'GST'` and `taxRate` to `5` in both the API (`?? 'GST'`, `?? 5`) and the parser's initial values. `parseCost()` and `parseQuantity()` return `0` on unparseable input, so a malformed cell silently contributes zero. If `labour_rate`, `markup_percent`, or the price book are empty, the corresponding prompt lines are simply omitted and the model prices freely.

### 5.6 Internal vs customer-facing pricing

**Confirmed:** there is currently **no** internal/customer pricing split. `formatEstimateForDisplay()` ([estimate-summary.ts:370](lib/estimate-summary.ts:370)) collapses the five-column table to two columns (`Item | Cost`) for the share page and PDF, folding quantity and rate into the description text, for example "Labour (8 hrs @ $65.00/hr)". That is a presentation change only. Every line item is shown to the customer, and the totals are identical. No grouping exists.

## 6. Pricing and totals: section order

**Confirmed:** the stored section order is preamble, `## Scope of Work`, `## Line Items`, before-pricing sections (Assumptions and Exclusions), `## Pricing Summary`, after-pricing sections (Payment Terms, Notes). `# ` H1 lines are stripped at parse time. The Pricing Summary table is regenerated from line items on every serialize and every display, so the stored table text is never authoritative.

**Confirmed:** `tpe_estimates` has dedicated `scope`, `assumptions`, `payment_terms`, and `notes` columns. **No application code reads or writes them.** All of that content lives inside `summary`. They are dead columns like `tpe_estimate_line_items`.

## 7. Photos

### 7.1 Table and fields

**Confirmed** from `lib/database.types.ts:197-237`, `tpe_estimate_photos` has exactly: `id`, `estimate_id`, `storage_path`, `original_filename`, `mime_type`, `file_size`, `created_at`, `updated_at`.

**Confirmed:** there is no `note` column and no `file_name` column. `CLAUDE.md` was stale on both. Corrected as part of this audit (section 14).

**Confirmed:** there is no `visibility`, `display_order`, or `caption` column. Photo inclusion is all-or-nothing per estimate via `tpe_estimates.include_photos`.

### 7.2 Upload

**Confirmed:** `POST /api/estimates/[id]/photos` ([route.ts](app/api/estimates/[id]/photos/route.ts)). **Pro-gated server-side** (`business.plan !== "pro"` returns 403). Accepts `{ photos: [{ base64 }] }`, max 5 photos, max 2MB each after base64 decode. Everything is re-labelled as JPEG regardless of the source: `contentType: "image/jpeg"`, `mime_type: "image/jpeg"`, filename `${uuid}.jpg`. Storage path is `${user.id}/${estimateId}/${uuid}.jpg` in the `tpe-estimate-photos` bucket.

**Confirmed:** photos here are attached to an **existing** estimate, so after generation. This is distinct from `/api/analyze-photo`, which turns photos into a job description before generation and never stores them.

### 7.3 Effect on generation

**Confirmed:** stored estimate photos do not affect the main `/api/generate-estimate` flow. They are used by `POST /api/estimates/[id]/analyze-photos`, which `handleCreateEstimate()` calls when converting a `needs_review` website quote request ([estimate-actions.tsx:170](app/components/estimate-actions.tsx:170)), feeding photo notes into the draft summary.

### 7.4 Display

**Confirmed contractor view:** `app/estimates/[id]/page.tsx:50-68` fetches photo rows and mints a 24 hour signed URL per photo, then renders `EstimatePhotos`. Pro users get a per-photo remove button and a toggle labelled "Add photos to estimate" / "Remove photos from estimate" which PATCHes `include_photos`.

**Confirmed customer view:** `app/share/[id]/page.tsx:120` renders a photo grid only when `estimate.include_photos && photoUrls.length > 0`. The PDF receives `photoUrls={estimate.include_photos ? photoUrls : []}` ([page.tsx:144](app/share/[id]/page.tsx:144)) and `lib/generate-pdf.ts:306-354` embeds them.

**This means roadmap Phase 5 is largely already built at the estimate level.** What does not exist is per-photo selection, cover/before/scope-reference roles, ordering, captions, and metadata stripping.

### 7.5 Deletion

**Confirmed:** `DELETE /api/estimates/[id]/photos` is Pro-gated and expects a JSON body `{ storage_path }`. It looks the row up by `estimate_id` + `storage_path`, removes the storage object, then deletes the row.

**Confirmed bug, FIXED 2026-07-30:** `EstimatePhotos.removePhoto()` sent `{ url }`, not `{ storage_path }`, and the value it sent was a **signed URL**, not a storage path, so the route returned 400 and photo removal could never succeed. The component now takes `photos: { url, storagePath }[]` and sends `{ storage_path }`. The signed URL remains display-only. See section 13, item 9.

**Confirmed:** `DELETE /api/estimates` does clean up photos correctly on estimate deletion ([route.ts:146-160](app/api/estimates/route.ts:146)), using the real `storage_path` values.

### 7.6 Privacy and access

**Confirmed:** the bucket is private and accessed only through short-lived signed URLs minted server-side (24 hours on both page loads, 1 year at upload time in the POST response). **Confirmed:** no EXIF or location metadata stripping exists anywhere in the codebase.

## 8. PDF, SMS, email, and share links

### 8.1 Share link

**Confirmed:** the URL is `${origin}/share/${estimateId}` where origin is the request `origin` header, else `NEXT_PUBLIC_APP_URL`, else `https://www.trytradepulse.com` ([send-sms/route.ts:100](app/api/send-sms/route.ts:100)).

**Confirmed:** `/share/[id]` is in `PUBLIC_PATHS` and performs **no authentication and no token check**. The estimate UUID is the only secret. It also does not check `status`, so a `draft` or `needs_review` estimate is publicly readable by anyone who has or guesses the id. **Inference:** a v4 UUID is not practically guessable, so this is a design choice rather than an exploitable hole, but there is no revocation, no expiry, and no separate share token.

### 8.2 SMS

**Confirmed:** `POST /api/send-sms`, Twilio, requires subscription access (not Pro). Message is "Hi {name}, {business} has sent you an estimate: {shareUrl}". On success it sets `status: "sent"`, `sent_via: "sms"`, `sent_at`, backfills `customer_phone` if empty, and logs a `sent` audit row. Canadian and Australian number normalisation is handled by a local `formatPhone()`.

### 8.3 Email

**Confirmed:** `POST /api/send-email`, Resend. Same status/`sent_via`/`sent_at` write and the same audit log call.

### 8.4 Copy link

**Confirmed:** `SendEstimateSheet` writes the share URL to the clipboard, then PATCHes: draft becomes `sent` plus `copied_at`; already-sent updates `copied_at` only; done is skipped ([send-estimate-sheet.tsx:91](app/components/send-estimate-sheet.tsx:91)). **Confirmed:** copying therefore counts as delivery and advances state, but writes no audit row, unlike SMS and email.

### 8.5 PDF

**Confirmed:** `lib/generate-pdf.ts`, jsPDF, A4 portrait, generated **client-side** in the browser. Offered from `DownloadPdfButton` on both the contractor estimate view and the public share page. Includes the logo, business header, customer block, the same `formatEstimateForDisplay()` content, and photos when `include_photos` is set.

### 8.6 Consistency across channels

**Confirmed:** the share page and the PDF both render `formatEstimateForDisplay(summary)`, so their content matches. SMS and email carry only a link to that same share page, so all four customer-facing surfaces show identical content.

**Confirmed difference:** the contractor estimate view renders `EditableEstimateBody` from the raw `summary` instead, which exposes the five-column structured table with Qty, Unit, and Rate. That is the only place quantity and rate appear as separate columns. It is an editing affordance, not a deliberate internal-vs-customer pricing split, and the underlying numbers are identical.

### 8.7 Tracking and resend

**Confirmed tracked:** `sent_at`, `sent_via`, `copied_at`, `status`. **Confirmed not tracked:** delivery success beyond the provider call returning, opens, views, clicks, or bounces. Resend is unrestricted: "Send Estimate" stays available after sending and each send overwrites `sent_at` and `sent_via`, keeping only the most recent.

## 9. Mark Job Done and reviews

**Confirmed appearance rules** ([estimate-actions.tsx:306-326](app/components/estimate-actions.tsx:306)): the "Mark Job Done" button renders only when `localStatus === "sent"` **and** `isPro`. It is hidden for draft, for `needs_review`, for already-done estimates, and for all Starter users.

**Confirmed action:** `handleMarkDone()` PATCHes `status: "done"` and `completed_at: now` via `PATCH /api/estimates`. It does **not** touch payment state. On success it opens `MarkJobDoneSheet`, choosing the initial panel by whether `googleReviewLink` is set (`"review-ready"` or `"needs-link"`).

**Confirmed review request:** `POST /api/estimates/[id]/review-request`. Gates in order: authenticated, business exists, estimate belongs to the business, `plan === "pro"` (403), `google_review_link` set (400), `customer_phone` present (400), and `review_requested_at` empty unless `force: true` (409).

**Confirmed it is not automatic.** The sheet opens with an editable message; the contractor must submit. The Google review link is appended to the message body server-side. On success `review_requested_at` is stamped, and the UI then shows "Review request sent" with a "Send Again" affordance that re-opens the sheet (which passes `force`).

**Confirmed:** for a `sent` Pro estimate with a review link, the UI shows "Review request available after completion", so reviews are gated behind job completion by design.

## 10. Payments and invoicing

### 10.1 Marking invoiced

**Confirmed:** `PATCH /api/estimates/[id]/invoice` sets `invoice_amount` (positive number), `due_date` (validated as a real date, today or later), `payment_status: "unpaid"`, `reminder_count: 0`, `last_reminder_sent_at: null`.

**Confirmed:** the UI entry point is a button labelled **"Send Payment Reminder"**, shown when the estimate is `done`, has no invoice, and is not already paid. It opens `InvoiceSheet`, pre-filled with the estimate total when available.

### 10.2 Marking paid

**Confirmed:** `PATCH /api/estimates/[id]/mark-paid` sets `payment_status: "paid"` and `completed_at: now`. The UI requires a two-tap inline confirm ("Mark as Paid" then "Confirm, mark as paid?").

### 10.3 Reminders

**Confirmed:** `GET /api/cron/payment-reminders`, authorised by `Authorization: Bearer CRON_SECRET`, scheduled daily at 17:00 UTC in `vercel.json`. It selects estimates where `payment_status = 'unpaid'` with a non-null `due_date` and `invoice_amount`. Stages are `pre_due` (due minus 2 days), `overdue_1` (plus 1), `overdue_2` (plus 5), then `overdue_ongoing` weekly from plus 14 days. `reminder_count` tracks how many stages have fired. Each send writes a `tpe_payment_reminders` row and goes out by both SMS and email where contact details and provider env vars exist. Invoice reference is `estimate.id.slice(0, 8)`.

### 10.4 `/payments`

**Confirmed:** server component, Pro-gated in the page with an upgrade screen for Starter. Lists unpaid invoices with due dates, days overdue, and last reminder sent. Not in the bottom nav; reached from an "Unpaid Invoices" pill on `/estimates`.

### 10.5 Pro gating

**Confirmed inconsistency, FIXED 2026-07-30:** `/payments` and the Mark Job Done path were Pro-gated, but `PATCH /api/estimates/[id]/invoice` and `PATCH /api/estimates/[id]/mark-paid` had **no plan check at all**, and the reminder cron did not filter by plan. All three now use `hasProPaymentsAccess()` from `lib/auth.ts`, which requires `plan === 'pro'` plus a live subscription (active, complimentary, or an unexpired trial). The two routes return 403 `{ error: "Pro plan required" }`, matching the convention in `photos/route.ts` and `review-request/route.ts`. The cron filters its batched business lookup and skips estimates whose business is not entitled, so a lapsed or Starter account no longer has reminders sent to its customers. See section 13, item 11.

### 10.6 Is there an invoice object?

**Confirmed: no.** There is no invoice table, no invoice document, no invoice PDF, and no invoice number beyond the first 8 characters of the estimate UUID. "Marking invoiced" writes three fields onto the estimate row and starts a reminder schedule.

**Confirmed:** `invoice_amount` is a single number typed by the contractor. It is pre-filled from the estimate total but is not derived from, or reconciled against, the line items. Changing the estimate afterwards does not change `invoice_amount`.

## 11. Estimate editor and customer-page performance

### 11.1 What was verified

- **Confirmed:** `npx tsc --noEmit` passes with no errors.
- **Confirmed:** `npx next build` compiles successfully in about 15 seconds, 52 static pages generated, no build errors or warnings.
- **Confirmed:** both `/estimates/[id]` and `/share/[id]` build as `ƒ` (dynamic, server-rendered on demand). Neither is static or cached.
- **Confirmed:** a local dev server rendered `/share/<non-existent-uuid>` correctly to the "Estimate not found." state, and `/demo` rendered fully, both with **zero console errors, zero hydration warnings, and zero server errors**.
- **Confirmed:** at a 412px mobile viewport, `/demo` had no horizontal overflow (`scrollWidth` 412 equals `clientWidth` 412).
- **Confirmed** (dev server, so indicative only): `/demo` TTFB 71ms, load event 250ms.

### 11.2 What was not verified, and why

**Unknown: all authenticated and populated-estimate performance.** The estimate editor at `/estimates/[id]` and a populated `/share/[id]` both require a real, owned estimate. Per this project's established constraint, the local environment points at the **production** Supabase project, so creating an estimate to measure would create production data. The task forbids that, so I did not.

This also means the following are **Unknown**: large-estimate behaviour, image-heavy estimate behaviour, desktop layout of a real estimate, real share-page load time, and interaction or accessibility failures in the editor.

**Unknown: automated test results.** The Playwright smoke suite in `tests/smoke/` was read but **not executed**. It signs up real users, calls the real Anthropic API, and touches live Stripe. Running it would create production data and incur real spend, which this task prohibits. Its 15 spec files were reviewed for behavioural claims only.

**Unknown: numeric Core Web Vitals.** No production build was served and no measurement tooling exists in the project. Installing any was out of scope.

### 11.3 Performance risks identified by reading, not measurement

**Confirmed code shape, Inference on impact:** both `app/estimates/[id]/page.tsx:56-68` and `app/share/[id]/page.tsx:58-67` mint signed URLs in a **sequential `for` loop with `await` inside**, one round trip per photo, before the page can render. With the 5 photo maximum that is up to 5 serial storage calls added to server render time on a route that is already fully dynamic. `Promise.all` would remove this. Not a bug, but the most likely cause of slow share-page loads on photo-heavy estimates.

**Confirmed:** photos are served at full uploaded resolution (up to 2MB each) into `aspect-square object-cover` grid cells. There is no thumbnail, no resizing, and `next/image` is deliberately bypassed with plain `<img>` and an eslint disable. On mobile data, five 2MB images is a real cost.

## 12. Confirmed existing capabilities

Do not rebuild any of these.

- Job description input, dictation (`/api/transcribe-audio`), and photo-to-description (`/api/analyze-photo`)
- User-defined labour rate, markup, deposit percent, deposit threshold, tax label, and tax rate
- User-defined reusable price book items (`tpe_pricebook_items`, full CRUD plus bulk import)
- AI estimate generation with price book injection, streaming
- Scope of work, line items, assumptions and exclusions, pricing summary, payment terms in the generated output
- Full line item editing including quantity, unit, and rate, with code-recomputed totals
- Customer name, phone, email, and job address, editable after generation
- Shareable public customer estimate page
- Client-side PDF generation and download, from both contractor and customer views
- SMS delivery (Twilio) and email delivery (Resend), both stamping `status`, `sent_via`, `sent_at`
- Copy link, which also advances state and stamps `copied_at`
- Mark Job Done (Pro)
- Google review request by SMS with an editable message, resend support, and eligibility gating (Pro)
- Invoice marking with amount and due date, mark paid, four-stage automated payment reminders by SMS and email, and a `/payments` list (Pro in the UI)
- **Photos attached to an estimate, with a contractor toggle controlling whether they appear on the customer share page and in the PDF**

## 13. Confirmed gaps

Product gaps, verified absent:

1. **No customer approval.** No approve, decline, or request-change flow. No signature. No approval snapshot. Nothing for a customer to do on the share page except read and download.
2. **No view tracking.** Nothing records that a customer opened the share page, so "Viewed" cannot be shown and follow-up cannot be triggered by it.
3. ~~**No grouped or customer-friendly pricing.**~~ **FIXED 2026-08-02 for newly generated structured estimates.** Eligible structured drafts now have a contractor-controlled Detailed or Grouped customer presentation behind the existing server-side feature flag. Historical markdown estimates remain unchanged and have no toggle.
4. **No estimate versioning or immutable snapshot.** Editing a sent estimate silently changes what the customer sees at the same URL.
5. **No real invoice object.** See section 10.6.
6. **No follow-up automation** for unaccepted estimates. Payment reminders exist; estimate follow-up does not.
7. **No per-photo control.** All-or-nothing only, no captions, ordering, roles, or metadata stripping.
8. **No state-driven primary action.** The action bar branches on an ad hoc mix of `status`, `isDone`, `hasInvoice`, and `localPaymentStatus` rather than a single state model.

Defects and risks found while auditing. **Documented, not fixed**, per the task scope:

9. ~~**Photo removal is broken.**~~ **FIXED 2026-07-30.** `EstimatePhotos.removePhoto()` sent `{ url }` with a signed URL; `DELETE /api/estimates/[id]/photos` requires `{ storage_path }` and returned 400. The component now receives `photos: { url, storagePath }[]` from `app/estimates/[id]/page.tsx` and sends `{ storage_path }`, and it only drops a photo from the UI once the server confirms the delete. Files: `app/components/estimate-photos.tsx`, `app/estimates/[id]/page.tsx`. Test: `tests/smoke/photo-delete-uses-storage-path.spec.ts`.
10. ~~**`completed_at` is overwritten by mark-paid.**~~ **FIXED 2026-07-30.** `/api/estimates/[id]/mark-paid` no longer writes `completed_at`; it writes payment state only. `completed_at` is now owned solely by Mark Job Done. File: `app/api/estimates/[id]/mark-paid/route.ts`. Test: `tests/smoke/payments-pro-enforced.spec.ts`.
11. ~~**Invoice and mark-paid routes are not Pro-gated server-side.**~~ **FIXED 2026-07-30.** Both routes and the reminder cron now use a single shared predicate, `hasProPaymentsAccess()` in `lib/auth.ts`, which requires `plan === 'pro'` **and** a live subscription. The cron filters its already-batched business lookup with it and explicitly skips estimates whose business is not entitled, so no extra queries were added. Files: `app/api/estimates/[id]/invoice/route.ts`, `app/api/estimates/[id]/mark-paid/route.ts`, `app/api/cron/payment-reminders/route.ts`, `lib/auth.ts`. Tests: `tests/smoke/pro-payments-entitlement.spec.ts` (pure, runnable) and `tests/smoke/payments-pro-enforced.spec.ts`.
12. **Dead schema.** `tpe_estimate_line_items` and the `scope`, `assumptions`, `payment_terms`, `notes` columns on `tpe_estimates` are never read or written by application code. Any future work that assumes line items live in a table will be wrong.
13. **Audit log is nearly empty.** Only `sent` is ever recorded. Section 4.5.
14. **Pre-existing lint failures.** `npx eslint` reports 7 errors and 18 warnings on untouched code: `react-hooks/set-state-in-effect` in `app/signup/page.tsx:30`, and two `@typescript-eslint/no-explicit-any` in `lib/audit-log.ts`. Present before this audit; no code was changed.
15. **Share links cannot be revoked or expired.** Section 8.1.

## 14. Documentation mismatches corrected

Corrected in `CLAUDE.md` as part of this audit, all verified against `lib/database.types.ts` and route code:

- `tpe_estimate_photos` was documented with `file_name` and `note`. Actual fields are `original_filename`, `mime_type`, `file_size`, `updated_at`. Corrected.
- `tpe_estimates` was documented with a `customer_id` column. **No such column exists.** Corrected.
- `tpe_estimates` was missing `include_photos`, `description`, `service_type`, `location`, `urgency`, `updated_at`, and the unused `scope`, `assumptions`, `payment_terms`, `notes`. Added, with the unused ones flagged.
- `tpe_pricebook_items` was documented with `category`, `labour_price`, `material_price`. It also has `description`, and only `labour_price` reaches generation. Corrected.
- `tpe_businesses` pricing fields were incomplete. `deposit_threshold`, `tax_label`, and `tax_rate` were undocumented. Added.
- `tpe_estimate_line_items` was documented as a live table. Flagged as unused.
- The Photo Input section described photos as never stored. That is true of `/api/analyze-photo` but not of `/api/estimates/[id]/photos`. Clarified.

Corrected in `TRADEPULSE_ESTIMATES_ROADMAP.md`: Problem E and Phase 5, which described customer-visible photos as not yet built. Section 7.4 shows the estimate-level capability exists.

## 15. Unverified or uncertain items

- **Unknown:** all runtime behaviour of the authenticated estimate editor and a populated share page, including performance, large estimates, image-heavy estimates, and interaction and accessibility failures. Reason: requires production data. Section 11.2.
- **Unknown:** whether the Playwright smoke suite currently passes. Not executed, for the same reason.
- **Unknown:** the exact database-level type and any CHECK constraint on `tpe_estimates.status` and `payment_status`. The generated types say `string`, so no constraint is visible from the repository, but the live database was not queried.
- **Unknown:** how `needs_review` estimates are actually created. No route in this repository writes that status. **Inference:** an external website form or another service inserts them directly.
- **Unknown:** whether RLS policies match the code's ownership checks. Every route audited uses `supabaseAdmin`, which bypasses RLS, so the policies were not exercised and were not read.
- **Unknown:** real-world reliability of the AI honouring the labour rate and markup instructions, since these are prompt-level, not code-level. Section 5.2.
- **Inference, not confirmed:** the photo-deletion bug (gap 9) is read from the code contract on both sides. I did not execute it.

## 16. Recommended next implementation phase

**Recommended: Phase 1, customer-friendly pricing presentation, but scoped narrower than the roadmap describes, and preceded by a decision on where line items live.**

Reasoning from the audit rather than roadmap order:

- Phase 5 (photos) is largely built already, so it is no longer a sensible "next".
- Phase 2 (approval) and Phase 3 (invoice conversion) both depend on an estimate snapshot and a coherent state model, neither of which exists (gaps 4 and 8). Building approval on top of a mutable markdown blob would mean a contractor can silently change what was approved.
- Phase 1 is the only high-priority phase with no hard dependency on the missing state model, and it is the one the audit shows is genuinely unbuilt (gap 3).

The blocking question Phase 1 must answer first: **line items live in markdown, and `tpe_estimate_line_items` is dead.** Grouping requires a group label per line item, and there is nowhere to put one without either extending the markdown table format or reviving the table. That decision should be made before implementation starts, not during it.

**End-to-end generation VERIFIED 2026-07-31.** One controlled test generation was run against production through the real `/new` page and `/api/generate-estimate` route, using a synthetic account created directly (no Stripe, no signup route) and clearly synthetic customer data ("Structured Pricing Test", `structured-pricing-test@example.test`, `604-555-0100`, "123 Example Street, Vancouver, BC"). No SMS, email, review request, invoice, or payment reminder was triggered.

**Result: full success.** The generated estimate (status `draft`, never sent) landed with `pricing_source = 'structured'` and `customer_pricing_mode = 'detailed'`. 4 structured rows were written, matching the 4 parsed markdown rows exactly, with 2 rows correctly assigned to the "Plumbing" work package and 2 left honestly ungrouped (a bare "Labour" row and "Teflon tape and fittings", neither of which matches a keyword rule). **Totals matched exactly**: structured subtotal $482.50 against a markdown subtotal of $482.50 computed independently by the real parser, tax $24, total $506.50, no deposit. No duplicate rows.

**Detailed rendering confirmed unchanged** on both the contractor estimate page and the public share page, verified against the actual server-rendered HTML: the same title, the same four line-item rows in the same order with the same prices, the same subtotal, and critically **zero occurrences of any grouped-pricing term or structured-storage field** (no "group_label", "Work package", "pricing_source", "item_type", etc.) in either page's output. The PDF download control fired with no console error. **The internal grouped renderer, run against this real estimate's actual structured rows, produced a grouped subtotal of $482.50, exactly matching the detailed subtotal**, with every row landing in exactly one group. The flag remained off throughout and no customer route references the grouped renderer.

**All 29 pre-existing estimates remain untouched**: still `pricing_source = 'markdown'`, confirmed by an exact count immediately after the test. `tpe_estimates` grew from 29 to 30 (the one authorized test estimate) and `tpe_estimate_items` grew from 0 to 4 (only that estimate's rows).

**The test estimate, and the synthetic business and account it belongs to, remain in the database.** Deletion was not performed because a hard delete is not reversible, per this task's own disposition rule; the estimate's `business_id` foreign key additionally has no cascade, so removing the business without first removing the estimate is not possible. All three are clearly labelled as synthetic test data (business name "Structured Pricing Test (synthetic, do not send)"), the estimate is a `draft` that was never sent, and it is not exposed to anyone. Full detail in `HANDOFF.md`.

**One-generation limitation.** Only one generation was tested against the production path. It hit the common well-formed case: a five-column line-items table, four rows, no multi-option headings. A malformed table, a multi-option estimate, or a case where the Anthropic API call itself fails has not been exercised through the wired code live. The conversion is designed to fail safe (best-effort, non-fatal), but that design is unproven under production error conditions. **Conversion-only timing was not measured separately.** The total round trip includes the Anthropic generation, the DB insert, and the structured conversion bundled together; isolating the conversion step would have required timing instrumentation that was out of scope for this verification.

**Structured generation for NEW estimates added 2026-07-31.** `/api/generate-estimate` now attempts a structured conversion immediately after saving a newly generated estimate, assigning work-package groups via the keyword classifier in `lib/estimate-groups.ts`. It is **best effort and strictly non-fatal**: any refusal or error leaves the estimate markdown-authoritative, exactly as before. **The markdown summary is always preserved**, and **no renderer changed**, so the share page, PDF, editor, and preview are byte-for-byte identical for every estimate. **No existing estimate is affected**: the lazy conversion path still writes `group_label` null, and all 29 production estimates remain `pricing_source = 'markdown'`, `customer_pricing_mode = 'detailed'`, with the content fingerprint `152dab94ef40910e348e7867c08e4439` unchanged and `tpe_estimate_items` still holding 0 rows. A grouped renderer exists in `lib/estimate-groups.ts` behind `isGroupedPricingEnabled()` (env `ESTIMATE_GROUPED_PRICING_INTERNAL`, default off) and is **not reachable by any customer**. Grouped totals were proved equal to detailed totals for every fixture and through the real database function.

**Lazy conversion service added 2026-07-31.** Full detail in `TRADEPULSE_ESTIMATE_ITEM_CONVERSION.md`. `lib/estimate-item-migration.ts` plus the PostgreSQL function `tpe_convert_estimate_to_structured` can convert one eligible estimate atomically. **No production estimate has been converted: `tpe_estimate_items` still holds 0 rows and all 29 estimates remain `pricing_source = 'markdown'`.** **No automatic wiring exists**: nothing in `app/` or `proxy.ts` imports the service, no route or UI invokes it, and dry-run is the default. **Markdown remains authoritative until a conversion actually succeeds.** **Sent and customer-visible estimates are blocked** (`sent_at` set, or status `sent`/`done`), and **multi-option estimates are blocked** with `MULTI_OPTION_ESTIMATE_UNSUPPORTED`. Atomicity was proved by execution: a subtotal mismatch after insert rolled the inserted rows back and left `pricing_source` unflipped. This does not alter any verified fact recorded below.

**Structured schema added 2026-07-31 (slice 1).** Full detail in `TRADEPULSE_ESTIMATE_ITEMS_SCHEMA.md`. `tpe_estimate_items` now exists with 18 columns, 7 check constraints, a cascading foreign key to `tpe_estimates`, and one composite index on `(estimate_id, display_order)`. `tpe_estimates` gained `pricing_source` (default `markdown`) and `customer_pricing_mode` (default `detailed`), both check-constrained. **The table remains completely unused: zero rows, and no application code references it or either new column.** **All 29 existing estimates remain markdown-authoritative** (`pricing_source = 'markdown'`) and **remain in detailed customer mode**. **No backfill and no application wiring occurred**, and no estimate content changed: the pre-migration content fingerprint `152dab94ef40910e348e7867c08e4439` and `max(updated_at)` are both unchanged. RLS is enabled with zero policies, exactly matching all eight sibling tables; anonymous reads return empty and anonymous writes are rejected with `42501`. This does not alter any verified fact recorded below.

**Real production format audit completed 2026-07-31.** Full results in `TRADEPULSE_ESTIMATE_FORMAT_AUDIT.md`. **29 estimates audited, every one of them, read-only. No production data was created, updated, or deleted**, verified before and after (29 rows both times, `max(updated_at)` unchanged at 2026-07-30, 0 rows touched during the audit window). Conversion: **25 pass (86.2%), 4 fail (13.8%)**, with **zero** subtotal, tax, grand total, or deposit differences anywhere and a byte-identical line-item block on every estimate. Format mix: 20 legacy two-column (69.0%), 5 five-column (17.2%), 2 multi-option (6.9%), 2 headingless (6.9%). All 4 failures are unsent drafts; **all 4 customer-visible estimates pass**. Migration eligibility: 21 eligible (72.4%), 4 blocked as customer-visible (13.8%), 4 requiring manual review (13.8%). **No stray totals row was found in any stored estimate**, so the double-counting corruption is a real parser defect that has not yet occurred in production data. New format class discovered: multi-option "Good/Better/Best" estimates carry several `## Line Items - Option N` headings, which `parseSummary()` does not recognise, so they already total zero and cannot be sent in the shipped app. That is a pre-existing defect, recorded and not repaired. **Architecture gate: PASSED.**

**Slice 2 implemented 2026-07-31.** The pure conversion layer now exists at `lib/estimate-items.ts`. **It is not wired into production:** the only importer anywhere in the repository is its test, and no route, page, component, cron, prompt, or database code references it. **Markdown remains authoritative** for line items; the drafts it produces are temporary conversion output that is never persisted, never dual written, and never marks an estimate as structured. **No estimate storage changed**, and no application behaviour changed. A synthetic invariant corpus was added at `tests/fixtures/estimate-summaries/` (24 valid, 13 negative) together with `tests/smoke/estimate-items-conversion.spec.ts`. All 24 valid fixtures preserve subtotal, tax, grand total, and deposit exactly, and re-render a byte-identical line-item block. **Real stored-estimate corpus verification is still outstanding:** the corpus is synthetic and does not claim to represent the production format distribution.

**Resolved 2026-07-30.** See `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md` for the full comparison and `DECISIONS.md` for the recorded decision. Outcome: priced line items move to a new structured table, prose stays markdown, structured rows are authoritative for pricing per estimate via a one-way `pricing_source` flag, existing and sent estimates are preserved unchanged, and `tpe_estimate_line_items` is replaced rather than reused. That document also records two defects measured in the current markdown format during the comparison: a stray Subtotal row silently doubles a subtotal, and the parse-serialize round trip drops the H1 title on first edit. Neither alters the verified facts in this baseline.

## 17. Grouped customer pricing toggle, verified 2026-08-02

**Implemented and controlled-verification passed.** Newly generated estimates whose `pricing_source = 'structured'` can now switch between Detailed and Grouped customer pricing on the contractor estimate page. Detailed remains the default and the saved choice persists only in `tpe_estimates.customer_pricing_mode`. The control requires structured rows, an authenticated owner, the exact server flag `ESTIMATE_GROUPED_PRICING_INTERNAL=true`, and an unprotected draft. It is absent from public share pages and from markdown, rowless, sent, copied, done, invoiced/payment-state, or review-requested estimates.

The precedence rule is exact: when the global flag is absent or not exactly `true`, Grouped cannot be selected or rendered; Detailed always remains available. When the flag is enabled, an eligible estimate's persisted mode selects the output. Production configuration was not enabled or edited in this task.

One server-safe pricing view builds the contractor, public share, and PDF summary from structured rows for prices, markdown for prose, and the persisted mode for presentation. Detailed output kept the same descriptions, order, prices, subtotal, tax, total, deposit, and prose for every convertible fixture. Structured prices are read-only in the existing editor so markdown edits cannot become a competing price source. Grouped output combines visible rows with the same label, preserves first appearance, places null labels under `Additional items`, and includes no individual prices, hidden priced rows, duplicate rows, labour details, unit costs, markup, item types, or database fields. Missing rows, invalid mode, a disabled flag, and any structured-versus-markdown subtotal disagreement fail closed to the existing detailed markdown; the contractor sees a short internal error and the public page does not receive database details.

**Controlled production-backed result.** The existing synthetic draft was switched Detailed to Grouped and back through the authenticated local contractor UI. In Grouped, contractor, share, and the visually inspected two-page A4 PDF all showed `Additional items` $252.50 and `Plumbing` $230, subtotal $482.50, GST $24, total $506.50, no deposit, and balance $506.50. After restoration, contractor and share returned to the same four detailed rows in the same order. Final read-only counts were 30 estimates: 29 markdown, 1 structured, and all 30 Detailed. The single structured estimate remained a draft with 4 rows and every protected field null. No historical migration, customer communication, send state, completion, invoice, payment, review, or follow-up change occurred.

**Indicative local dev observations:** contractor detail 3.4s cold and 0.85s to 1.16s warm; share 3.5s cold and 0.51s to 1.07s warm; mode save 2.9s cold and 0.74s warm. The PDF was generated, text-extracted, rendered to PNG, and visually inspected; exact client generation timing was not captured because the browser runtime did not emit a download event although the file appeared on disk.

**Remaining limitations:** production remains gated off; historical markdown estimates still have no toggle or lazy conversion; grouping remains keyword-based; structured line-item editing now needs a future atomic rows-first editor path; PDF pagination was not redesigned; RLS policy and synthetic-account cleanup decisions remain open.

Suggested next implementation slice: customer approval and change requests backed by immutable estimate snapshots.

The defects in section 13 (items 9, 10, 11) are small, independent, and worth fixing before or alongside any phase. Item 9 in particular is user-visible broken functionality.
