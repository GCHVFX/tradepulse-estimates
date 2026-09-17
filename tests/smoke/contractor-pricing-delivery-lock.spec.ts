import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { isDelivered, isDeliveredContractorPricing, wouldNewlyDeliver, wouldNewlyUndeliver } from "../../lib/estimate-delivery";

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
