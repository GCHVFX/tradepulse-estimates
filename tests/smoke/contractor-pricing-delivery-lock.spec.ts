import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import {
  isDelivered,
  isDeliveredContractorPricing,
  violatesDeliveryStatusInvariant,
  wouldNewlyDeliver,
  wouldNewlyUndeliver,
} from "../../lib/estimate-delivery";
import { Fragment, createElement, forwardRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ContractorPricingEditor } from "../../app/components/contractor-pricing-editor";
import { calculateContractorPricing } from "../../lib/contractor-pricing";
import type { ContractorPricingRowInput } from "../../lib/contractor-pricing-form";

/**
 * Phase 1 slice 5B: delivery gating and the customer-document lock
 * (specs/contractor-owned-pricing.md sections 12 and 13).
 *
 * No browser, no network, no database, no live account. The subtle part of
 * this slice -- exactly which field patch newly delivers an estimate, and
 * exactly which estimate/classification combination locks its document -- is
 * exercised as real behaviour against the actual exported functions the
 * routes call (wouldNewlyDeliver, isDeliveredContractorPricing). Route wiring
 * that those functions don't cover (ordering of a check relative to a side
 * effect, which fields a route touches at all) falls back to static source
 * assertions, the same convention tests/smoke/estimate-resending.spec.ts and
 * tests/smoke/generation-contractor-pricing.spec.ts already use for that
 * kind of claim.
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

// ── wouldNewlyDeliver: the PATCH first-delivery gate ────────────────────────

test("wouldNewlyDeliver is true for every first-delivery transition, not just status='sent'", () => {
  const draft = { sent_at: null, copied_at: null, status: "draft" };

  expect(wouldNewlyDeliver(draft, { status: "sent" })).toBe(true);
  // The bug this test guards against: a route that only checked
  // status === "sent" let a PATCH move a still-incomplete estimate straight
  // to status: "done" and skip the completeness gate entirely.
  expect(wouldNewlyDeliver(draft, { status: "done" })).toBe(true);
  expect(wouldNewlyDeliver(draft, { copied_at: "2026-09-17T00:00:00.000Z" })).toBe(true);
});

test("wouldNewlyDeliver is false for an unrelated patch, and false once already delivered", () => {
  const draft = { sent_at: null, copied_at: null, status: "draft" };
  // A PATCH that touches neither status nor copied_at (e.g. editing
  // customer_name) must not trigger the completeness gate.
  expect(wouldNewlyDeliver(draft, {})).toBe(false);

  // Already delivered by status: sent -> done is operational progression,
  // not a new delivery, and must never re-run completeness.
  const sent = { sent_at: null, copied_at: null, status: "sent" };
  expect(wouldNewlyDeliver(sent, { status: "done" })).toBe(false);

  // Already delivered by copied_at alone (status never left "draft"): a
  // later status: "done" is still not a *new* delivery.
  const copiedOnly = { sent_at: null, copied_at: "2026-09-16T00:00:00.000Z", status: "draft" };
  expect(wouldNewlyDeliver(copiedOnly, { status: "done" })).toBe(false);

  // Already delivered by sent_at (e.g. via send-sms/send-email, which never
  // go through this route at all, but the predicate must still agree).
  const emailedAlready = { sent_at: "2026-09-15T00:00:00.000Z", copied_at: null, status: "sent" };
  expect(wouldNewlyDeliver(emailedAlready, { status: "done" })).toBe(false);
});

// ── wouldNewlyUndeliver: the PATCH un-delivery guard ────────────────────────

test("wouldNewlyUndeliver rejects a status patch that would flip an already-delivered estimate back to false", () => {
  // The exact scenarios named in review: a delivered estimate whose status
  // alone carries delivery (sent_at and copied_at both null, which is an
  // edge case, not a normal path, but the guard has to hold regardless of
  // how that state arose) patched back to "draft".
  const sentOnly = { sent_at: null, copied_at: null, status: "sent" };
  expect(wouldNewlyUndeliver(sentOnly, { status: "draft" })).toBe(true);

  const doneOnly = { sent_at: null, copied_at: null, status: "done" };
  expect(wouldNewlyUndeliver(doneOnly, { status: "draft" })).toBe(true);

  // Delivered by sent_at or copied_at instead: status alone can never undo
  // that, because isDelivered() still sees the other field set.
  const byCopiedAt = { sent_at: null, copied_at: "2026-09-16T00:00:00.000Z", status: "sent" };
  expect(wouldNewlyUndeliver(byCopiedAt, { status: "draft" })).toBe(false);

  const bySentAt = { sent_at: "2026-09-15T00:00:00.000Z", copied_at: null, status: "sent" };
  expect(wouldNewlyUndeliver(bySentAt, { status: "draft" })).toBe(false);
});

test("wouldNewlyUndeliver allows sent -> done, and is false for anything not already delivered", () => {
  const sentOnly = { sent_at: null, copied_at: null, status: "sent" };
  // Legitimate operational progression: still delivered afterwards.
  expect(wouldNewlyUndeliver(sentOnly, { status: "done" })).toBe(false);
  // No patch at all: nothing changes, still delivered.
  expect(wouldNewlyUndeliver(sentOnly, {})).toBe(false);

  // Never delivered to begin with: there is nothing to undeliver.
  const draft = { sent_at: null, copied_at: null, status: "draft" };
  expect(wouldNewlyUndeliver(draft, { status: "draft" })).toBe(false);
});

// ── Cross-route escape: PATCH cannot open a two-call bypass ────────────────

test("a rejected undeliver attempt leaves isDelivered() true, so the pricing route's identical check still holds", () => {
  // Models the two-call escape this guard exists to close: (1) PATCH the
  // delivered estimate back to undelivered, (2) reprice it through
  // PUT /api/estimates/[id]/pricing while the earlier gates believe it is
  // still safe. Step 1 is rejected -- proven above -- so the row PATCH would
  // have written is never written; the estimate a subsequent call reads is
  // byte-identical to `delivered` below.
  // status is the only delivery signal here -- sent_at and copied_at are
  // both null -- which is exactly the case a status-only guard would miss.
  const delivered = { sent_at: null, copied_at: null, status: "sent" };
  const attemptedPatch = { status: "draft" };

  expect(wouldNewlyUndeliver(delivered, attemptedPatch)).toBe(true);
  // Because the PATCH route returns 409 before calling .update() whenever
  // wouldNewlyUndeliver() is true (proven by source inspection below), the
  // stored row is untouched: isDelivered(delivered) is exactly what a
  // second call still reads.
  expect(isDelivered(delivered)).toBe(true);

  // tpe_save_contractor_pricing's own delivered check
  // (supabase/migrations/20260916000000_add_contractor_pricing_snapshots_and_save_fn.sql)
  // raises ESTIMATE_DELIVERED on `sent_at is not null or copied_at is not
  // null or status in ('sent','done')` -- the identical three fields
  // isDelivered() reads -- so it still refuses this same row independently
  // of whether the PATCH route's own guard exists. Defense in depth: proven
  // directly against the real transaction in
  // tests/smoke/contractor-pricing-route.spec.ts's "the transaction
  // re-checks delivery, so a delivered estimate cannot be repriced".
});

test("PATCH returns before .update() whenever wouldNewlyUndeliver() is true -- the rejected row is never written", () => {
  const route = code("app/api/estimates/route.ts");
  const undeliverCheckIndex = route.indexOf("if (wouldNewlyUndeliver(existing, deliveryPatch)) {");
  const updateCallIndex = route.indexOf('.from("tpe_estimates")\n    .update(updateFields)');
  expect(undeliverCheckIndex).toBeGreaterThan(-1);
  expect(updateCallIndex).toBeGreaterThan(undeliverCheckIndex);

  // Between the check and the eventual write sits only the locked-fields
  // check's own return, the wouldNewlyDeliver branch (mutually exclusive:
  // isDelivered(existing) already decided which branch runs), and the
  // structured-items sync -- every exit in between is a `return applyTo(...)`
  // before reaching .update(). Concretely: the check itself is a `return`.
  const checkBlock = route.slice(undeliverCheckIndex, route.indexOf("}", route.indexOf("status: 409", undeliverCheckIndex)));
  expect(checkBlock).toContain("return applyTo(");
});

// 1 & 10. PATCH /api/estimates uses that shared predicate, not a second one -

test("PATCH classifies before gating, and never runs contractor-pricing checks on legacy or inbound intake", () => {
  const route = code("app/api/estimates/route.ts");
  const classifyIndex = route.indexOf("const pricingClass = classifyEstimate(existing);");
  const gateIndex = route.indexOf('if (pricingClass === "contractor_pricing") {');
  expect(classifyIndex).toBeGreaterThan(-1);
  expect(gateIndex).toBeGreaterThan(classifyIndex);
});

test("PATCH gates a first delivery through wouldNewlyDeliver(), not a hand-picked value check", () => {
  const route = code("app/api/estimates/route.ts");
  expect(route).toContain("if (wouldNewlyDeliver(existing, deliveryPatch)) {");
  expect(route).toContain("const pricing = await contractorPricingCompleteness(estimateId, existing);");
  expect(route).toContain("if (!pricing.complete) {");
  // No second, narrower re-implementation of "does this deliver it" left
  // behind alongside the shared predicate.
  expect(route).not.toMatch(/updateFields\.status === "sent" \|\| "copied_at" in updateFields/);

  // deliveryPatch is built once, before the isDelivered(existing) split, and
  // shared by both branches -- wouldNewlyDeliver() on one side,
  // wouldNewlyUndeliver() on the other -- so the two can never observe a
  // different view of the same patch.
  const deliveryPatchIndex = route.indexOf("const deliveryPatch: EstimateDeliveryPatch = {};");
  const splitIndex = route.indexOf("if (isDelivered(existing)) {");
  const undeliverIndex = route.indexOf("if (wouldNewlyUndeliver(existing, deliveryPatch)) {");
  const deliverIndex = route.indexOf("if (wouldNewlyDeliver(existing, deliveryPatch))");
  expect(deliveryPatchIndex).toBeGreaterThan(-1);
  expect(splitIndex).toBeGreaterThan(deliveryPatchIndex);
  expect(undeliverIndex).toBeGreaterThan(splitIndex);
  expect(deliverIndex).toBeGreaterThan(undeliverIndex);

  // The completeness check sits inside the not-yet-delivered branch of the
  // isDelivered(existing) split, not standalone -- it must never re-run (and
  // never refuse) an operational update to an estimate already delivered.
  const deliveredBranch = route.slice(splitIndex, deliverIndex);
  expect(deliveredBranch).toContain("} else {");
  expect(deliveredBranch.indexOf("} else {")).toBeGreaterThan(0);
});

test("PATCH rejects an already-delivered estimate's status moving away from sent/done while sent_at and copied_at stay unset", () => {
  const route = code("app/api/estimates/route.ts");
  expect(route).toContain("if (wouldNewlyUndeliver(existing, deliveryPatch)) {");
  expect(route).toContain("cannot be marked undelivered");

  // This check has to sit inside the isDelivered(existing) branch, after the
  // locked-fields check and before the else branch's first-delivery gate --
  // it answers a different question (is this *specific* estimate, already
  // delivered, about to become undelivered) than either of those.
  const splitIndex = route.indexOf("if (isDelivered(existing)) {");
  const lockedFieldsIndex = route.indexOf("const lockedFieldsTouched = LOCKED_CUSTOMER_FIELDS.filter((field) => field in updateFields);");
  const undeliverIndex = route.indexOf("if (wouldNewlyUndeliver(existing, deliveryPatch)) {");
  const elseIndex = route.indexOf("} else {", undeliverIndex);
  expect(splitIndex).toBeGreaterThan(-1);
  expect(lockedFieldsIndex).toBeGreaterThan(splitIndex);
  expect(undeliverIndex).toBeGreaterThan(lockedFieldsIndex);
  expect(elseIndex).toBeGreaterThan(undeliverIndex);
});

test("PATCH never accepts sent_at: it has no field-construction branch for it at all", () => {
  const route = code("app/api/estimates/route.ts");
  expect(route).not.toContain('"sent_at" in body');
  expect(route).not.toContain("updateFields.sent_at");
  // The request body's own declared shape has no sent_at key either -- not
  // just an omitted runtime check.
  const bodyTypeBlock = route.slice(route.indexOf("let body: {"), route.indexOf("};", route.indexOf("let body: {")));
  expect(bodyTypeBlock).not.toContain("sent_at");
});

test("PATCH cannot be used to clear copied_at on a contractor_pricing estimate", () => {
  const route = code("app/api/estimates/route.ts");
  expect(route).toContain('if ("copied_at" in updateFields && updateFields.copied_at === null) {');
  expect(route).toContain("copied_at cannot be cleared");
});

// 4 & 5. Delivered contractor_pricing rejects customer-visible PATCH mutations,
// but legitimate operational updates (status progression) remain allowed ----

test("delivered contractor_pricing locks customer-visible fields, but not status, completed_at or copied_at", () => {
  const route = code("app/api/estimates/route.ts");
  expect(route).toContain("const LOCKED_CUSTOMER_FIELDS = [");

  const lockedFieldsBlock = route.slice(
    route.indexOf("const LOCKED_CUSTOMER_FIELDS = ["),
    route.indexOf("] as const;") + "] as const;".length
  );
  for (const field of [
    "title",
    "summary",
    "customer_name",
    "customer_phone",
    "customer_email",
    "job_address",
    "include_photos",
  ]) {
    expect(lockedFieldsBlock).toContain(`"${field}"`);
  }
  // Operational progression (sent -> done), the invoice/payment workflow's
  // own fields, and re-copying an already-delivered link are deliberately
  // never in this list.
  for (const field of ["status", "completed_at", "copied_at", "deposit_amount"]) {
    expect(lockedFieldsBlock).not.toContain(`"${field}"`);
  }

  expect(route).toContain("const lockedFieldsTouched = LOCKED_CUSTOMER_FIELDS.filter((field) => field in updateFields);");
  expect(route).toContain("if (lockedFieldsTouched.length > 0) {");
});

test("a draft->done PATCH on an incomplete contractor_pricing estimate is rejected by the same gate a draft->sent PATCH is", () => {
  // This is the exact defect wouldNewlyDeliver exists to close: proven above
  // as real behaviour, restated here against the route's own gate structure
  // so the two do not silently drift apart. wouldNewlyDeliver(draft, {status:
  // "done"}) === true (asserted above) is what makes the route's
  // `if (wouldNewlyDeliver(existing, patch))` branch run
  // contractorPricingCompleteness for a draft -> "done" PATCH exactly as it
  // does for draft -> "sent".
  const draft = { sent_at: null, copied_at: null, status: "draft" };
  expect(wouldNewlyDeliver(draft, { status: "sent" })).toBe(wouldNewlyDeliver(draft, { status: "done" }));
});

// ── isDeliveredContractorPricing: the shared document lock ─────────────────

test("isDeliveredContractorPricing locks only a delivered contractor_pricing estimate", () => {
  const deliveredContractorPricing = {
    pricing_source: "contractor_pricing",
    source: "ai_generated",
    status: "sent",
    sent_at: null,
    copied_at: "2026-09-16T00:00:00.000Z",
  };
  expect(isDeliveredContractorPricing(deliveredContractorPricing)).toBe(true);

  const undeliveredContractorPricing = { ...deliveredContractorPricing, status: "draft", copied_at: null };
  expect(isDeliveredContractorPricing(undeliveredContractorPricing)).toBe(false);

  // A delivered legacy estimate is not locked by this predicate at all --
  // the contractor_pricing document lock has no jurisdiction over it.
  const deliveredLegacy = { ...deliveredContractorPricing, pricing_source: "markdown" };
  expect(isDeliveredContractorPricing(deliveredLegacy)).toBe(false);

  // A delivered website_quote_intake estimate: also not locked. (Delivering
  // one isn't a real flow today, but the predicate must not accidentally
  // treat it as contractor_pricing.)
  const deliveredIntake = {
    pricing_source: "markdown",
    source: "website_quote",
    status: "sent",
    sent_at: "2026-09-16T00:00:00.000Z",
    copied_at: null,
  };
  expect(isDeliveredContractorPricing(deliveredIntake)).toBe(false);
});

// 2. send-sms / send-email refuse an incomplete contractor_pricing estimate,
// and never backfill a customer contact field onto an already-delivered
// contractor_pricing document -----------------------------------------------

for (const routeFile of ["app/api/send-sms/route.ts", "app/api/send-email/route.ts"]) {
  test(`${routeFile} checks contractor-pricing completeness before any side effect`, () => {
    const source = code(routeFile);
    expect(source).toContain("const pricingClass = classifyEstimate(estimate);");
    expect(source).toContain('if (pricingClass === "contractor_pricing") {');
    expect(source).toContain("const pricing = await contractorPricingCompleteness(estimateId, estimate);");
    expect(source).toContain("if (!pricing.complete) {");
    expect(source).toContain("cannot be sent yet");

    // The completeness check has to run before claimDelivery -- the first
    // side effect either route performs (a suppression/claim row, then the
    // provider call) -- or an incomplete estimate could still claim a send
    // slot and burn a provider call before being refused.
    const classifyIndex = source.indexOf("const pricingClass = classifyEstimate(estimate);");
    const claimIndex = source.indexOf("claimDelivery(supabaseAdmin");
    expect(classifyIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(classifyIndex);
  });

  test(`${routeFile} never writes a customer contact field onto an already-delivered contractor_pricing estimate`, () => {
    const source = code(routeFile);
    expect(source).toContain("isDeliveredContractorPricing(estimate)");
    // Whichever contact field this route backfills, the write is guarded by
    // the shared lock predicate rather than only "was it previously empty".
    const backfillLine = routeFile.includes("send-sms")
      ? "!estimate.customer_phone && !lockCustomerDetails"
      : "!storedEmail && !isDeliveredContractorPricing(estimate)";
    expect(source).toContain(backfillLine);
  });
}

// 7. Resend never regenerates or recalculates ------------------------------

test("send-sms and send-email never write to tpe_estimate_items or recompute pricing", () => {
  for (const routeFile of ["app/api/send-sms/route.ts", "app/api/send-email/route.ts"]) {
    const source = code(routeFile);
    expect(source).not.toContain("tpe_estimate_items");
    expect(source).not.toContain("calculateContractorPricing(");
  }
});

// 3. Copy link performs server delivery before clipboard copy --------------

test("copy link PATCHes and awaits the response before any clipboard write", () => {
  const sheet = code("app/components/send-estimate-sheet.tsx");

  const patchIndex = sheet.indexOf('fetch("/api/estimates", {');
  const clipboardIndex = sheet.indexOf("writeToClipboard(shareUrl)");
  expect(patchIndex).toBeGreaterThan(-1);
  expect(clipboardIndex).toBeGreaterThan(patchIndex);

  // The PATCH is awaited and its ok-ness checked before the function ever
  // reaches the clipboard step -- not fired-and-forgotten the way the
  // previous implementation did.
  expect(sheet).toContain("res = await fetch(");
  expect(sheet).toContain("if (!res.ok) {");
  const resOkIndex = sheet.indexOf("if (!res.ok) {");
  expect(clipboardIndex).toBeGreaterThan(resOkIndex);

  // A refused PATCH returns before writeToClipboard is ever reached.
  const refusalBlock = sheet.slice(resOkIndex, clipboardIndex);
  expect(refusalBlock).toContain("return;");
});

test("a clipboard failure after a successful delivery does not undo it or retry the PATCH", () => {
  const sheet = code("app/components/send-estimate-sheet.tsx");
  expect(sheet).toContain("const copiedOk = await writeToClipboard(shareUrl);");
  expect(sheet).toContain("if (!copiedOk) {");
  // No second PATCH call anywhere in the function -- the source has exactly
  // one fetch to /api/estimates for the whole copy-link flow.
  const patchCallCount = sheet.split('fetch("/api/estimates", {').length - 1;
  expect(patchCallCount).toBe(1);
});

// 6. Photo routes reject add/delete on a delivered contractor_pricing estimate

test("photo POST and DELETE both check the shared delivery lock before touching storage or the database", () => {
  const route = code("app/api/estimates/[id]/photos/route.ts");
  expect(route).toContain("function deliveryLockError(estimate: PhotoLockEstimate): NextResponse | null {");
  expect(route).toContain("if (!isDeliveredContractorPricing(estimate)) return null;");

  const lockCallCount = route.split("const lockError = deliveryLockError(estimate);").length - 1;
  expect(lockCallCount).toBe(2);

  // Both call sites check the lock immediately after the ownership lookup
  // and before any storage or table write below them.
  const firstUploadCall = route.indexOf(".upload(storagePath, buffer,");
  const firstLockCall = route.indexOf("const lockError = deliveryLockError(estimate);");
  expect(firstLockCall).toBeGreaterThan(-1);
  expect(firstUploadCall).toBeGreaterThan(firstLockCall);
});

// 8. Legacy never runs contractor-pricing completeness or lock logic --------

test("legacy and website_quote_intake estimates never reach the completeness or lock checks", () => {
  // classifyEstimate (directly, or through isDeliveredContractorPricing) is
  // the single ordered gate every one of these routes checks against; the
  // pure classification rules themselves are already covered by
  // tests/smoke/customer-pricing.spec.ts, and the lock predicate's own
  // legacy/intake exclusion is proven above.
  const directClassifiers = ["app/api/estimates/route.ts", "app/api/send-sms/route.ts", "app/api/send-email/route.ts"];
  for (const routeFile of directClassifiers) {
    const source = code(routeFile);
    expect(source).toContain('"contractor_pricing"');
    expect(source).toContain("classifyEstimate(");
  }

  const photosRoute = code("app/api/estimates/[id]/photos/route.ts");
  expect(photosRoute).toContain("isDeliveredContractorPricing(estimate)");
});

// 9. B3 ownership protection is untouched -----------------------------------

test("estimate deletion ownership protection is unaffected by this slice", () => {
  const route = code("app/api/estimates/route.ts");
  expect(route).toContain("deleteOwnedEstimate(id, business.id, {");
  expect(route).toContain("findOwnedEstimate: async (estimateId, businessId) => {");
});

// Sanity: isDelivered itself is unchanged by this slice's additions --------

test("isDelivered's own rule is untouched: sent_at, copied_at or status in (sent, done)", () => {
  expect(isDelivered({ sent_at: null, copied_at: null, status: "draft" })).toBe(false);
  expect(isDelivered({ sent_at: "2026-09-16T00:00:00.000Z", copied_at: null, status: "draft" })).toBe(true);
  expect(isDelivered({ sent_at: null, copied_at: "2026-09-16T00:00:00.000Z", status: "draft" })).toBe(true);
  expect(isDelivered({ sent_at: null, copied_at: null, status: "sent" })).toBe(true);
  expect(isDelivered({ sent_at: null, copied_at: null, status: "done" })).toBe(true);
});

// ── Delivered pricing is shown locked, matching the server lock ─────────────
//
// A real server render of ContractorPricingEditor (react-dom/server, with a
// stub app router in context): no DOM, no network, no database. Effects do
// not run in a server render, so this checks the markup only; the readiness
// publisher's delivered guard is pinned from source below.

// Playwright's test runner compiles JSX in imported .tsx files to its own
// plain objects ({__pw_type: "jsx", type, props, key}; playwright/jsx-runtime),
// meant for its component-testing mode. This turns them back into the React
// elements they describe -- same type, props and key -- and wraps function and
// forwardRef components so what they render is converted too, while React
// itself still calls them (so their hooks run normally).
type PwNode = { __pw_type: "jsx"; type: unknown; props: Record<string, unknown>; key?: string | null };
const isPwNode = (value: unknown): value is PwNode =>
  typeof value === "object" && value !== null && (value as { __pw_type?: unknown }).__pw_type === "jsx";
const wrapped = new Map<unknown, unknown>();
function realType(type: unknown): unknown {
  if (typeof type === "object" && type !== null && (type as { __pw_jsx_fragment?: boolean }).__pw_jsx_fragment) return Fragment;
  if (typeof type === "string") return type;
  if (wrapped.has(type)) return wrapped.get(type);
  let result: unknown = type;
  if (typeof type === "function") {
    const component = type as (props: unknown) => unknown;
    result = (props: unknown) => realize(component(props));
  } else if (typeof type === "object" && type !== null && typeof (type as { render?: unknown }).render === "function") {
    const render = (type as { render: (props: unknown, ref: unknown) => unknown }).render;
    result = forwardRef(function RealizedForwardRef(props: unknown, ref: unknown) {
      return realize(render(props, ref)) as never;
    });
  }
  wrapped.set(type, result);
  return result;
}
function realize(node: unknown): ReactNode {
  if (Array.isArray(node)) return node.map(realize) as ReactNode;
  if (!isPwNode(node)) return node as ReactNode;
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.props ?? {})) props[name] = name === "children" ? realize(value) : value;
  if (node.key !== undefined && node.key !== null) props.key = node.key;
  return createElement(realType(node.type) as never, props);
}

function renderEditor(delivered: boolean, rows: ContractorPricingRowInput[]): string {
  const router = { refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} };
  const pricing = calculateContractorPricing(rows, { taxRatePercent: 5, depositPercent: 10, depositThresholdDollars: 50 });
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(realType(ContractorPricingEditor) as typeof ContractorPricingEditor, {
        estimateId: "00000000-0000-0000-0000-000000000000",
        currency: "cad",
        initialRows: rows,
        initialTax: { label: "GST", rate: 5 },
        initialPricing: pricing,
        defaults: { labourRate: 95, markupPercent: 20 },
        isDelivered: delivered,
        depositPercent: 10,
        depositThresholdDollars: 50,
      })
    )
  );
}

const genericRows: ContractorPricingRowInput[] = [
  { item_type: "labour", unit: "hr", quantity: 2, unit_price: 95, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
  { item_type: "material", unit: null, quantity: 1, unit_price: 100, markup_percent: 20, description: "Materials", display_order: 1, taxable: true },
  { item_type: "other", unit: null, quantity: 1, unit_price: 150, markup_percent: null, description: "Permit", display_order: 2, taxable: true },
];
const savedItemRows: ContractorPricingRowInput[] = [
  { item_type: "labour", unit: "ea", quantity: 1, unit_price: 110, markup_percent: null, description: "Kitchen faucet replacement", display_order: 0, taxable: true },
  { item_type: "material", unit: "ea", quantity: 1, unit_price: 0, markup_percent: 0, description: "Kitchen faucet replacement", display_order: 1, taxable: true },
];

const inputsOf = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);

test("delivered generic pricing: every field is read-only (not disabled), no Save, no Add charge, no Remove, no Switch, totals and the locked notice shown", () => {
  const html = renderEditor(true, genericRows);
  const inputs = inputsOf(html);
  // Hours, rate, materials cost, markup, charge description + amount, tax label + rate.
  expect(inputs).toHaveLength(8);
  for (const input of inputs) {
    expect(input).toMatch(/readOnly=""/i);
    expect(input).toContain('tabindex="-1"');
    expect(input).not.toContain("disabled");
    expect(input).toContain("text-zinc-900");
    expect(input).not.toContain("focus:ring-amber-500");
  }
  // The values stay visible.
  for (const value of ['value="2"', 'value="95"', 'value="100"', 'value="20"', 'value="Permit"', 'value="150"', 'value="GST"', 'value="5"']) {
    expect(html).toContain(value);
  }
  expect(html).not.toContain("Save pricing");
  expect(html).not.toContain("Add charge");
  expect(html).not.toContain(">Remove<");
  expect(html).not.toContain("Switch to");
  expect(html).not.toContain("<button");
  // Totals remain.
  for (const label of ["Labour", "Materials", "Other charges", "Subtotal", "Tax", "Total"]) {
    expect(html).toContain(`>${label}</dt>`);
  }
  expect(html).toContain("Pricing is locked because this estimate has been sent.");
  expect(html).toContain("Create a new estimate to change pricing.");
});

test("delivered saved-item pricing: item fields read-only, no Remove, no suggestions, no Save", () => {
  const html = renderEditor(true, savedItemRows);
  const inputs = inputsOf(html);
  // Description, qty, labour, materials, tax label + rate.
  expect(inputs).toHaveLength(6);
  for (const input of inputs) expect(input).toMatch(/readOnly=""/i);
  expect(html).toContain('value="Kitchen faucet replacement"');
  expect(html).not.toContain("<button");
  expect(html).not.toContain("Save pricing");
  expect(html).toContain("Pricing is locked because this estimate has been sent.");
});

test("a delivered estimate with no charges renders no empty charges section", () => {
  const html = renderEditor(true, genericRows.slice(0, 2));
  expect(html).not.toContain("Other charges");
  expect(html).not.toContain("Add charge");
});

test("the undelivered editor is unchanged: editable fields, Switch, Add charge, Remove and Save pricing, and no locked notice", () => {
  const html = renderEditor(false, genericRows);
  const inputs = inputsOf(html);
  expect(inputs).toHaveLength(8);
  for (const input of inputs) {
    expect(input).not.toMatch(/readOnly/i);
    expect(input).not.toContain("tabindex");
    expect(input).toContain("focus:ring-amber-500");
  }
  expect(html).toContain("Save pricing");
  expect(html).toContain("Add charge");
  expect(html).toContain(">Remove</button>");
  expect(html).toContain("Switch to fixed price");
  expect(html).not.toContain("Pricing is locked");

  const items = renderEditor(false, savedItemRows);
  expect(items).toContain(">Remove</button>");
  for (const input of inputsOf(items)) expect(input).not.toMatch(/readOnly/i);
});

test("delivered mode never publishes send readiness, so Resend, Mark Job Done and Send gating cannot be flipped by the editor", () => {
  const editor = code("app/components/contractor-pricing-editor.tsx");
  const start = editor.indexOf("const publishedSendReadyRef = useRef(sendReady);");
  expect(start).toBeGreaterThan(-1);
  const effect = editor.slice(start, editor.indexOf("}, [sendReady, isDelivered]);", start));
  expect(effect).toContain("if (isDelivered) return;");
  expect(effect.indexOf("if (isDelivered) return;")).toBeLessThan(effect.indexOf("window.dispatchEvent("));

  // And the delivered actions do not read that signal anyway: Resend and
  // Mark Job Done render from localStatus, and the bar shows for "sent".
  const actions = code("app/components/estimate-actions.tsx");
  expect(actions).toContain('return state.isQuoteRequest || state.isDone || state.localStatus === "sent" || !state.sendBlocked;');
});

test("the page and the server lock on the same predicate: isDelivered in page.tsx and the pricing route, and the same three fields in the save function", () => {
  const page = code("app/estimates/[id]/page.tsx");
  expect(page).toContain('import { isDelivered } from "@/lib/estimate-delivery";');
  expect(page).toContain("{isDelivered(estimate) ? (");
  const route = code("app/api/estimates/[id]/pricing/route.ts");
  expect(route).toContain('import { isDelivered } from "@/lib/estimate-delivery";');
  expect(route).toContain("if (isDelivered(estimate)) {");
  const migration = code("supabase/migrations/20260918160315_add_taxable_to_contractor_pricing_save_fn.sql");
  expect(migration).toContain("if v_estimate.sent_at is not null");
  expect(migration).toContain("or v_estimate.copied_at is not null");
  expect(migration).toContain("or v_estimate.status in ('sent', 'done') then");

  for (const status of ["draft", "sent", "done", "needs_review"]) {
    for (const sentAt of [null, "2026-09-18T00:00:00Z"]) {
      for (const copiedAt of [null, "2026-09-18T00:00:00Z"]) {
        const sqlLocks = sentAt !== null || copiedAt !== null || status === "sent" || status === "done";
        expect(isDelivered({ status, sent_at: sentAt, copied_at: copiedAt }), `${status} ${sentAt} ${copiedAt}`).toBe(sqlLocks);
      }
    }
  }
});

// ── PATCH /api/estimates: a delivery marker must come with status sent/done ──
//
// The route merges the existing row with the request and refuses (409) any
// resulting state with sent_at or copied_at set and a status other than
// "sent" or "done". The decision is violatesDeliveryStatusInvariant(),
// exercised here for every case; its placement in the route is pinned below.

const AT = "2026-09-18T00:00:00Z";
const draftRow = { status: "draft", sent_at: null, copied_at: null };
const copiedSentRow = { status: "sent", sent_at: null, copied_at: AT };
const smsSentRow = { status: "sent", sent_at: AT, copied_at: null };

test("resulting-state invariant: the ten request shapes", () => {
  // 1. draft + copied_at only -> rejected.
  expect(violatesDeliveryStatusInvariant(draftRow, { copied_at: AT })).toBe(true);
  // 2. draft + copied_at + status "sent" -> accepted.
  expect(violatesDeliveryStatusInvariant(draftRow, { copied_at: AT, status: "sent" })).toBe(false);
  // 3. marker already present + status "draft" -> rejected (copied_at and sent_at).
  expect(violatesDeliveryStatusInvariant(copiedSentRow, { status: "draft" })).toBe(true);
  expect(violatesDeliveryStatusInvariant(smsSentRow, { status: "draft" })).toBe(true);
  // 4. sent estimate remaining sent -> accepted.
  expect(violatesDeliveryStatusInvariant(smsSentRow, { status: "sent" })).toBe(false);
  expect(violatesDeliveryStatusInvariant(copiedSentRow, {})).toBe(false);
  // 5. ordinary unrelated draft PATCH (no delivery field in the request) -> accepted.
  expect(violatesDeliveryStatusInvariant(draftRow, {})).toBe(false);
  // 6. current Copy Link shapes -> accepted: first delivery, and a re-copy of
  //    a sent or done estimate (copied_at alone).
  expect(violatesDeliveryStatusInvariant(draftRow, { copied_at: AT, status: "sent" })).toBe(false);
  expect(violatesDeliveryStatusInvariant(smsSentRow, { copied_at: AT })).toBe(false);
  expect(violatesDeliveryStatusInvariant({ status: "done", sent_at: AT, copied_at: null }, { copied_at: AT })).toBe(false);
  // 7. sent_at cannot be PATCHed (the route has no sent_at field), so its cases
  //    are an existing sent_at with a status change: covered by 3, 4 and 9.
  expect(violatesDeliveryStatusInvariant({ status: "sent", sent_at: AT, copied_at: null }, { status: "needs_review" })).toBe(true);
  // 8. website-quote conversion: status "draft" with no marker -> accepted.
  expect(violatesDeliveryStatusInvariant({ status: "needs_review", sent_at: null, copied_at: null }, { status: "draft" })).toBe(false);
  // 9. Mark Job Done: status "done" on an estimate with sent_at or copied_at -> accepted.
  expect(violatesDeliveryStatusInvariant(smsSentRow, { status: "done" })).toBe(false);
  expect(violatesDeliveryStatusInvariant(copiedSentRow, { status: "done" })).toBe(false);
  // 10. marker present + status "needs_review" -> rejected.
  expect(violatesDeliveryStatusInvariant(copiedSentRow, { status: "needs_review" })).toBe(true);
  // Any other non-sent/done status too.
  expect(violatesDeliveryStatusInvariant(smsSentRow, { status: "archived" })).toBe(true);
  // Clearing copied_at leaves no marker, so the invariant has nothing to say
  // (contractor_pricing already refuses that clear with its own 400).
  expect(violatesDeliveryStatusInvariant({ status: "draft", sent_at: null, copied_at: AT }, { copied_at: null })).toBe(false);
});

test("isDelivered is unchanged by the split into hasDeliveryMarker and isDeliveredStatus", () => {
  for (const status of ["draft", "sent", "done", "needs_review", null]) {
    for (const sent_at of [null, AT]) {
      for (const copied_at of [null, AT]) {
        const expected = sent_at !== null || copied_at !== null || status === "sent" || status === "done";
        expect(isDelivered({ status, sent_at, copied_at })).toBe(expected);
      }
    }
  }
});

test("PATCH /api/estimates enforces the invariant for every estimate class, on the merged request, before anything is written", () => {
  const route = code("app/api/estimates/route.ts");
  const patchStart = route.indexOf("export async function PATCH(");
  const deleteStart = route.indexOf("export async function DELETE(");
  const patch = route.slice(patchStart, deleteStart);

  const check = patch.indexOf("if (violatesDeliveryStatusInvariant(existing, resultingDeliveryPatch)) {");
  expect(check, "the check exists in PATCH").toBeGreaterThan(-1);
  // Built from the request's own status and copied_at, merged onto `existing` by the helper.
  expect(patch).toContain('if ("status" in updateFields) resultingDeliveryPatch.status = updateFields.status as string;');
  expect(patch).toContain('if ("copied_at" in updateFields) resultingDeliveryPatch.copied_at = updateFields.copied_at as string | null;');
  // After the request fields are collected and after the contractor_pricing
  // gates (whose messages keep priority), outside that class-only block.
  expect(check).toBeGreaterThan(patch.indexOf('if ("copied_at" in body) {'));
  const contractorBlockEnd = patch.indexOf("  // Every estimate, every class:");
  expect(contractorBlockEnd).toBeGreaterThan(patch.indexOf('if (pricingClass === "contractor_pricing") {'));
  expect(check).toBeGreaterThan(contractorBlockEnd);
  // Before every write in PATCH.
  for (const write of ['.from("tpe_estimate_items")\n        .delete()', ".from(\"tpe_estimate_items\").insert(", ".update(updateFields)"]) {
    const index = patch.indexOf(write);
    expect(index, write).toBeGreaterThan(check);
  }
  // Refused with the route's existing 409 style.
  const refusal = patch.slice(check, patch.indexOf("\n  }\n", check));
  expect(refusal).toContain("{ status: 409 }");
  expect(refusal).toContain("return applyTo(");
});
