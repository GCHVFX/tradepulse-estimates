import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  acceptSuggestedItem,
  addCharge,
  chooseLabourMethod,
  centsToDollars,
  editTax,
  formSnapshot,
  hasEnteredGenericPricing,
  hasUnsavedPricingChanges,
  initContractorPricingEditorState,
  initContractorPricingForm,
  missingLabels,
  reconstructConfirmedItems,
  removeCharge,
  removeConfirmedItem,
  resolveContractorPricingGuidance,
  resolveContractorPricingPreview,
  shouldRevealSaveFeedback,
  shouldScrollToPricing,
  toPricingRequestPayload,
  updateCharge,
  updateConfirmedItem,
  withReconstructionGate,
  type BusinessPricingDefaults,
  type ContractorPricingRowInput,
} from "../../lib/contractor-pricing-form";
import { parseContractorPricingRequest, toCanonicalRows } from "../../lib/contractor-pricing-request";
import { calculateContractorPricing, type ContractorPricing } from "../../lib/contractor-pricing";
import { formatCentsAsCurrency } from "../../lib/currency";

/**
 * Phase 1 slice 3: the contractor pricing editor's state rules
 * (specs/contractor-owned-pricing.md sections 5, 6, 7, 11 and 12).
 *
 * Pure coverage. The component itself cannot be rendered in a spec here:
 * Playwright's JSX transform wraps elements in its own objects, which
 * react-dom/server refuses to render, so the rules live in a module the tests
 * drive directly and the component's wiring is checked against its source.
 */

const DEFAULTS: BusinessPricingDefaults = { labourRate: 95, markupPercent: 20 };
const NO_DEFAULTS: BusinessPricingDefaults = { labourRate: 0, markupPercent: 0 };
const GST_5 = { label: "GST", rate: 5 };

function row(overrides: Partial<ContractorPricingRowInput>): ContractorPricingRowInput {
  return {
    item_type: "labour",
    unit: null,
    quantity: 1,
    unit_price: 0,
    markup_percent: null,
    description: "Labour",
    display_order: 0,
    taxable: true,
    ...overrides,
  };
}

const HOURLY_ROW = row({ unit: "hr", quantity: 8, unit_price: 95 });
const MATERIALS_ROW = row({
  item_type: "material",
  description: "Materials",
  unit_price: 1150,
  markup_percent: 20,
});

/** Every payload must satisfy the route's own contract. */
function payloadOf(state: Parameters<typeof toPricingRequestPayload>[0]) {
  const payload = toPricingRequestPayload(state);
  const parsed = parseContractorPricingRequest(JSON.parse(JSON.stringify(payload)));
  expect(parsed.ok, parsed.ok ? "" : `route would reject this payload: ${parsed.error}`).toBe(true);
  return payload;
}

// ── Initialising from stored rows ────────────────────────────────────────────

test("3: no labour row means no method is selected and nothing is invented", () => {
  const form = initContractorPricingForm([], { label: null, rate: null }, DEFAULTS);

  expect(form.labourMethod).toBeNull();
  expect(form.hours).toBe("");
  expect(form.hourlyRate).toBe("");
  expect(form.fixedAmount).toBe("");
  expect(toPricingRequestPayload(form).labour).toBeNull();
});

test("stored rows initialise the form deterministically", () => {
  const hourly = initContractorPricingForm([HOURLY_ROW, MATERIALS_ROW], GST_5, DEFAULTS);
  expect(hourly).toMatchObject({
    labourMethod: "hourly",
    hours: "8",
    hourlyRate: "95",
    materialsCost: "1150",
    markupPercent: "20",
    taxLabel: "GST",
    taxRate: "5",
    taxEdited: false,
  });

  const fixed = initContractorPricingForm([row({ unit: null, unit_price: 760 })], GST_5, DEFAULTS);
  expect(fixed.labourMethod).toBe("fixed");
  expect(fixed.fixedAmount).toBe("760");
  expect(fixed.hours).toBe("");
});

// ── Labour ───────────────────────────────────────────────────────────────────

test("4: choosing hourly produces hourly semantic state", () => {
  let form = initContractorPricingForm([], GST_5, DEFAULTS);
  form = chooseLabourMethod(form, "hourly", DEFAULTS);
  form = { ...form, hours: "6" };

  expect(payloadOf(form).labour).toEqual({ method: "hourly", hours: 6, rate: 95 });
});

test("5: choosing fixed produces fixed semantic state, and replaces hourly input", () => {
  let form = initContractorPricingForm([HOURLY_ROW], GST_5, DEFAULTS);
  form = chooseLabourMethod(form, "fixed", DEFAULTS);

  expect(form.hours).toBe("");
  expect(form.hourlyRate).toBe("");
  expect(toPricingRequestPayload(form).labour).toBeNull();

  form = { ...form, fixedAmount: "500" };
  expect(payloadOf(form).labour).toEqual({ method: "fixed", amount: 500 });
});

test("6 and 7: fixed $0 is a real labour value, blank fixed labour is still unknown", () => {
  let form = chooseLabourMethod(initContractorPricingForm([], GST_5, DEFAULTS), "fixed", DEFAULTS);
  expect(toPricingRequestPayload(form).labour).toBeNull();

  form = { ...form, fixedAmount: "0" };
  expect(payloadOf(form).labour).toEqual({ method: "fixed", amount: 0 });
});

test("11: hourly with no rate keeps the hours and reports labour-rate-missing", () => {
  let form = chooseLabourMethod(initContractorPricingForm([], GST_5, NO_DEFAULTS), "hourly", NO_DEFAULTS);
  expect(form.hourlyRate).toBe("");

  form = { ...form, hours: "6" };
  expect(payloadOf(form).labour).toEqual({ method: "hourly", hours: 6, rate: 0 });
});

test("12 and 13: the business rate prefills a new hourly input and stays this estimate's value", () => {
  const withDefault = chooseLabourMethod(initContractorPricingForm([], GST_5, DEFAULTS), "hourly", DEFAULTS);
  expect(withDefault.hourlyRate).toBe("95");

  // An override is just this estimate's number. Nothing in the payload asks for
  // a business-default change; the save route decides that on its own.
  const overridden = { ...withDefault, hours: "4", hourlyRate: "150" };
  const payload = payloadOf(overridden);
  expect(payload.labour).toEqual({ method: "hourly", hours: 4, rate: 150 });
  expect(Object.keys(payload)).not.toContain("businessLabourRate");

  const withoutDefault = chooseLabourMethod(
    initContractorPricingForm([], GST_5, NO_DEFAULTS),
    "hourly",
    NO_DEFAULTS
  );
  expect(withoutDefault.hourlyRate).toBe("");
});

// ── Materials ────────────────────────────────────────────────────────────────

test("8 and 9: materials $0 is a real row, blank materials is still unknown", () => {
  const blank = initContractorPricingForm([], GST_5, DEFAULTS);
  expect(toPricingRequestPayload(blank).materials).toBeNull();

  const zero = { ...blank, materialsCost: "0" };
  expect(payloadOf(zero).materials).toEqual({ cost: 0, markupPercent: 20 });
});

test("10 and 14: markup 0% stays explicit, and the business default prefills a new input", () => {
  const stored = initContractorPricingForm(
    [row({ item_type: "material", description: "Materials", unit_price: 500, markup_percent: 0 })],
    GST_5,
    DEFAULTS
  );
  expect(stored.markupPercent).toBe("0");
  expect(payloadOf(stored).materials).toEqual({ cost: 500, markupPercent: 0 });

  const fresh = initContractorPricingForm([], GST_5, DEFAULTS);
  expect(fresh.markupPercent).toBe("20");
  // A markup on its own never creates a materials row.
  expect(toPricingRequestPayload(fresh).materials).toBeNull();
});

/*
 * Markup belongs to the estimate, not to Profile/Rates (spec section 6).
 *
 * A manual phone review reported that markup could only be changed in
 * Profile/Rates. These cases pin the opposite, at every layer the claim would
 * have to pass through: the field is on the estimate and editable, the stored
 * row is what fills it, an edit reaches the PUT, and neither direction leaks
 * into the business default.
 */

test("26: the markup field is on the estimate itself, and is editable", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  const start = editor.indexOf("Markup %");
  expect(start, "the Materials section exposes a markup input").toBeGreaterThan(-1);
  const markupBlock = editor.slice(start, start + 400);

  // Bound to this estimate's form value, and writable.
  expect(markupBlock).toContain("value={form.markupPercent}");
  expect(markupBlock).toMatch(/markupPercent:\s*event\.target\.value/);
  expect(markupBlock).not.toContain("readOnly");
  expect(markupBlock).not.toContain("disabled");

  // The contractor is never sent elsewhere (navigated away) to change it.
  // Phase 2 slice 4 does call the price-book-items resolve API from this
  // component (to price an accepted saved-item suggestion, unrelated to
  // markup), so the check is narrowed to navigation, not every occurrence
  // of the substring.
  expect(editor).not.toContain("/rates");
  expect(editor).not.toMatch(/href=\{?["'`][^"'`}]*price-book/);
});

test("27: editing markup changes the next PUT payload and leaves the rest alone", () => {
  const stored = initContractorPricingForm([HOURLY_ROW, MATERIALS_ROW], GST_5, DEFAULTS);
  expect(stored.markupPercent).toBe("20");

  const edited = { ...stored, markupPercent: "35" };
  const payload = payloadOf(edited);

  expect(payload.materials).toEqual({ cost: 1150, markupPercent: 35 });
  // A markup edit is not a labour, charge or tax edit.
  expect(payload.labour).toEqual({ method: "hourly", hours: 8, rate: 95 });
  expect(payload.charges).toEqual([]);
  expect(payload.tax).toBeNull();
});

test("28: markup edited to 0 is sent as 0 and comes back as 0", () => {
  const zeroed = { ...initContractorPricingForm([MATERIALS_ROW], GST_5, DEFAULTS), markupPercent: "0" };
  expect(payloadOf(zeroed).materials).toEqual({ cost: 1150, markupPercent: 0 });

  // Reloaded from the saved row, 0 stays visible as "0" and is never replaced
  // by the business default.
  const reloaded = initContractorPricingForm(
    [row({ item_type: "material", description: "Materials", unit_price: 1150, markup_percent: 0 })],
    GST_5,
    DEFAULTS
  );
  expect(reloaded.markupPercent).toBe("0");
  expect(payloadOf(reloaded).materials).toEqual({ cost: 1150, markupPercent: 0 });
});

test("29: changing the business default never moves an estimate that is already priced", () => {
  // Rates was changed to 50% after this estimate was saved at 20%.
  const moved: BusinessPricingDefaults = { labourRate: 95, markupPercent: 50 };

  const saved = initContractorPricingForm([MATERIALS_ROW], GST_5, moved);
  expect(saved.markupPercent).toBe("20");
  expect(payloadOf(saved).materials).toEqual({ cost: 1150, markupPercent: 20 });

  // The default is only ever a starting point for an estimate with no row yet.
  const fresh = initContractorPricingForm([], GST_5, moved);
  expect(fresh.markupPercent).toBe("50");
});

test("30: an estimate markup edit never writes the business markup default", () => {
  const edited = { ...initContractorPricingForm([MATERIALS_ROW], GST_5, DEFAULTS), markupPercent: "35" };
  const payload = payloadOf(edited);

  // The request has no way to carry a business default in the first place.
  expect(Object.keys(payload)).toEqual(["labour", "materials", "charges", "tax", "lineItems"]);

  // And the save transaction never sets it. Every update to tpe_businesses is
  // inspected, rather than searching the file for a string that also appears
  // on the estimate rows.
  const sql = readFileSync(
    "supabase/migrations/20260916000000_add_contractor_pricing_snapshots_and_save_fn.sql",
    "utf8"
  );
  const businessUpdates = sql
    .split("update public.tpe_businesses")
    .slice(1)
    .map((part) => part.split(";")[0]);

  expect(businessUpdates.length, "the save does write some business defaults").toBeGreaterThan(0);
  for (const statement of businessUpdates) {
    expect(statement, "no estimate save may write tpe_businesses.markup_percent").not.toContain(
      "markup_percent"
    );
  }
});

// ── Charges ──────────────────────────────────────────────────────────────────

test("15, 16 and 17: charges add, survive a save, and disappear when removed", () => {
  let form = initContractorPricingForm([], GST_5, DEFAULTS);
  form = addCharge(form);
  expect(form.charges).toHaveLength(1);

  form = updateCharge(form, form.charges[0].id, "description", "Permit");
  form = updateCharge(form, form.charges[0].id, "amount", "150");
  form = addCharge(form);
  form = updateCharge(form, form.charges[1].id, "description", "Disposal");
  form = updateCharge(form, form.charges[1].id, "amount", "75.5");

  expect(payloadOf(form).charges).toEqual([
    { description: "Permit", amount: 150 },
    { description: "Disposal", amount: 75.5 },
  ]);

  // A save round trip keeps both, because the next form is built from the rows.
  const saved = initContractorPricingForm(
    [
      row({ item_type: "other", description: "Permit", unit_price: 150, display_order: 0 }),
      row({ item_type: "other", description: "Disposal", unit_price: 75.5, display_order: 1 }),
    ],
    GST_5,
    DEFAULTS
  );
  expect(saved.charges.map((charge) => charge.description)).toEqual(["Permit", "Disposal"]);

  const afterRemoval = removeCharge(saved, saved.charges[0].id);
  expect(payloadOf(afterRemoval).charges).toEqual([{ description: "Disposal", amount: 75.5 }]);
});

test("18: a blank charge description is never sent", () => {
  let form = addCharge(initContractorPricingForm([], GST_5, DEFAULTS));
  form = updateCharge(form, form.charges[0].id, "amount", "40");

  expect(form.charges).toHaveLength(1);
  expect(payloadOf(form).charges).toEqual([]);

  form = updateCharge(form, form.charges[0].id, "description", "   ");
  expect(payloadOf(form).charges).toEqual([]);
});

// ── Tax ──────────────────────────────────────────────────────────────────────

test("19 and 20: untouched tax is omitted, edited tax is included", () => {
  const untouched = initContractorPricingForm([HOURLY_ROW], GST_5, DEFAULTS);
  expect(untouched.taxEdited).toBe(false);
  expect(toPricingRequestPayload(untouched).tax).toBeNull();

  const edited = editTax(editTax(untouched, "taxLabel", "HST"), "taxRate", "13");
  expect(edited.taxEdited).toBe(true);
  expect(payloadOf(edited).tax).toEqual({ label: "HST", rate: 13 });
});

// ── Full-state contract ──────────────────────────────────────────────────────

test("21: every payload carries labour, materials and charges", () => {
  const states = [
    initContractorPricingForm([], { label: null, rate: null }, NO_DEFAULTS),
    initContractorPricingForm([HOURLY_ROW, MATERIALS_ROW], GST_5, DEFAULTS),
    addCharge(initContractorPricingForm([], GST_5, DEFAULTS)),
  ];

  for (const state of states) {
    const payload = toPricingRequestPayload(state);
    expect(Object.keys(payload)).toEqual(expect.arrayContaining(["labour", "materials", "charges"]));
    // The route rejects a request with any of the three missing.
    const parsed = parseContractorPricingRequest(JSON.parse(JSON.stringify(payload)));
    expect(parsed.ok).toBe(true);
  }
});

test("this form has no confirmed Phase 2 line items yet: it always sends lineItems: []", () => {
  const states = [
    initContractorPricingForm([], { label: null, rate: null }, NO_DEFAULTS),
    initContractorPricingForm([HOURLY_ROW, MATERIALS_ROW], GST_5, DEFAULTS),
    addCharge(initContractorPricingForm([], GST_5, DEFAULTS)),
  ];
  for (const state of states) {
    expect(toPricingRequestPayload(state).lineItems).toEqual([]);
  }
});

// ── Missing reasons ──────────────────────────────────────────────────────────

test("23: the contractor is shown the backend's own missing reasons", () => {
  expect(missingLabels(["labour-missing", "materials-missing"])).toEqual([
    "Add labour",
    "Add materials, or enter 0",
  ]);
  expect(missingLabels(["labour-rate-missing"])).toEqual(["Add your hourly rate"]);
  expect(missingLabels(["tax-snapshot-missing"])).toEqual(["Set the tax rate"]);
  expect(missingLabels([])).toEqual([]);
});

test("cents are converted for display only", () => {
  expect(centsToDollars(240_450)).toBe(2404.5);
  expect(centsToDollars(0)).toBe(0);
});

// ── Component and page wiring ────────────────────────────────────────────────

test("1 and 2: contractor_pricing selects the new editor, everything else does not", () => {
  const page = readFileSync("app/estimates/[id]/page.tsx", "utf8");

  expect(page).toContain("ContractorPricingEditor");
  // Classification is the shared ordered rule, not an inline pricing_source
  // check (Phase 1 slice 5A).
  expect(page).toContain("const pricingClass = classifyEstimate(estimate);");
  expect(page).toContain('const isContractorPricing = pricingClass === "contractor_pricing";');
  // Everything else is legacy and read-only since slice 5A: the old markdown
  // editor is no longer mounted on this page at all.
  expect(page).not.toContain("EstimatePricingEditor");
});

test("22 and 25: the editor displays backend totals and never parses markdown", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  // Figures come from calculateContractorPricing's own result (reached via
  // the preview while undelivered, the saved response once delivered -- see
  // resolveContractorPricingPreview), never from arithmetic in the
  // component itself.
  expect(editor).toContain("preview.subtotalCents");
  expect(editor).toContain("preview.totalCents");
  expect(editor).not.toMatch(/subtotalCents\s*=\s*[^;]*[+*]/);
  expect(editor).not.toMatch(/taxCents\s*=\s*[^;]*[*/]/);

  // No markdown pricing anywhere near this editor.
  expect(editor).not.toContain("parseSummary");
  expect(editor).not.toContain("estimate-summary");
  expect(editor).not.toContain("line_total");

  const form = readFileSync("lib/contractor-pricing-form.ts", "utf8");
  expect(form).not.toContain("parseSummary");
  expect(form).not.toContain("estimate-summary");
});

test("24: a failed save reports the failure and does not claim success", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  // The saved state is only entered on a successful response. The guard also
  // rejects a 200 that carries no pricing, so it is not a bare !response.ok.
  expect(editor).toMatch(/if\s*\(!response\.ok/);
  expect(editor).toContain('setStatus("error")');
  expect(editor).toContain('setStatus("saved")');
  // The error path must not also mark it saved. Anchored on save()'s own
  // catch clause specifically: Phase 2 slice 4 added a second, earlier
  // "} catch (error) {" inside acceptSuggestion(), so this must not match
  // the first one in the file anymore.
  const saveStart = editor.indexOf("async function save() {");
  expect(saveStart, "the save function exists").toBeGreaterThan(-1);
  const catchIndex = editor.indexOf("} catch (error) {", saveStart);
  expect(catchIndex, "the save has a catch clause").toBeGreaterThan(-1);
  expect(editor.slice(catchIndex)).not.toContain('setStatus("saved")');
});

test("a long rejection message (e.g. the delivery-lock error) does not squeeze the Save pricing button on mobile", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  // Found on the phone: "This estimate has already gone to the customer and
  // cannot be repriced" sitting beside the button in a plain flex row with
  // no shrink protection squeezed it into a narrow, wrapped-text shape.
  // Column below sm, row at sm+ keeps the desktop look and puts the message
  // under a full-width mobile button instead of squeezing it.
  // The button is now wrapped in {!hideInlineSaveButton && (...)} (Phase 2
  // slice 4 follow-up: /new suppresses the duplicate inline button), so
  // this anchors directly on the wrapping div's own distinctive className
  // rather than a generic "nearest div before a button" search, which would
  // otherwise also match the unrelated guidance box above it (its own
  // "Save pricing to enable sending." text also contains "Save pricing").
  const containerStart = editor.indexOf('<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">');
  expect(containerStart, "the Save pricing button's wrapping div").toBeGreaterThan(-1);
  const container = editor.slice(containerStart, editor.indexOf("Save pricing", containerStart));
  expect(container).toContain("flex-col sm:flex-row");

  // The button itself no longer relies solely on the row layout to keep its
  // shape: it refuses to shrink or wrap its own label even if something else
  // ever puts it back in a horizontal row with a long sibling.
  const buttonMatch = editor.match(/<button[^>]*onClick=\{save\}[^>]*>/);
  expect(buttonMatch, "the Save pricing button element").not.toBeNull();
  expect(buttonMatch![0]).toContain("shrink-0");
  expect(buttonMatch![0]).toContain("whitespace-nowrap");
});

// ── Live pricing preview (production smoke: "WORKING AS BUILT BUT MISLEADING") ──
//
// The editor's totals and "Customer sees" line used to read every dollar
// figure from `pricing`, which only ever changes inside a successful Save --
// so a fresh estimate with real typed values still showed $0.00 everywhere
// until Save ran. resolveContractorPricingPreview() is the one place that
// now decides what is shown: a live preview of what Save would produce while
// undelivered, computed through the same toPricingRequestPayload ->
// toCanonicalRows -> calculateContractorPricing pipeline Save itself uses
// (so there is no second arithmetic definition to drift from the first),
// and the persisted, authoritative pricing once delivered.
//
// This module-level coverage proves the calculation/selection logic is
// correct. It cannot prove the component's JSX is actually bound to this
// function's result instead of `pricing` directly -- that requires either
// rendering the component (this project's tests cannot: see the file header
// comment) or reading the component's source, which the two tests after
// this section do.

const PREVIEW_SNAPSHOTS = { taxRatePercent: 5, depositPercent: 10, depositThresholdDollars: 50 };

function typedFixedLabourMaterialsForm(fixedAmount: string, materialsCost: string, markupPercent: string) {
  let form = initContractorPricingForm([], GST_5, NO_DEFAULTS);
  form = chooseLabourMethod(form, "fixed", NO_DEFAULTS);
  form = { ...form, fixedAmount, materialsCost, markupPercent };
  return form;
}

test("preview 1: a fresh undelivered draft previews exactly what Save would produce", () => {
  const form = typedFixedLabourMaterialsForm("100", "20", "25");

  const preview = resolveContractorPricingPreview(form, {
    isDelivered: false,
    persistedPricing: calculateContractorPricing([], PREVIEW_SNAPSHOTS), // all-zero, as a fresh estimate loads
    snapshots: PREVIEW_SNAPSHOTS,
  });

  expect(preview.labourCents).toBe(10000);
  expect(preview.materialsCents).toBe(2500);
  expect(preview.subtotalCents).toBe(12500);
  expect(preview.taxCents).toBe(625);
  expect(preview.totalCents).toBe(13125);
  expect(preview.depositCents).toBe(1313);
  expect(preview.balanceCents).toBe(11812);
});

test("preview 2: changing unsaved form values changes the returned preview without Save", () => {
  const persistedPricing = calculateContractorPricing([], PREVIEW_SNAPSHOTS);
  const before = resolveContractorPricingPreview(typedFixedLabourMaterialsForm("100", "20", "25"), {
    isDelivered: false,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });
  const after = resolveContractorPricingPreview(typedFixedLabourMaterialsForm("200", "20", "25"), {
    isDelivered: false,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });

  expect(before.labourCents).toBe(10000);
  expect(after.labourCents).toBe(20000);
  expect(before.totalCents).not.toBe(after.totalCents);
  // Neither preview ever touched `persistedPricing`, matching the component:
  // typing never mutates the last-saved state.
  expect(persistedPricing.labourCents).toBe(0);
});

test("preview 3: undelivered materials preview is cost plus markup, same as a saved materials row", () => {
  const form = typedFixedLabourMaterialsForm("0", "20", "25");

  const preview = resolveContractorPricingPreview(form, {
    isDelivered: false,
    persistedPricing: calculateContractorPricing([], PREVIEW_SNAPSHOTS),
    snapshots: PREVIEW_SNAPSHOTS,
  });

  // 2000 cents cost + 25% markup = 2500 cents, the same rule
  // calculateContractorPricing already applies to a persisted materials row.
  expect(preview.materialsCents).toBe(2500);
});

test("preview 4: a delivered estimate previews the persisted pricing, never the unsaved draft", () => {
  const persistedRows: ContractorPricingRowInput[] = [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 500, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 100, markup_percent: 10, description: "Materials", display_order: 1, taxable: true },
  ];
  const persistedPricing: ContractorPricing = calculateContractorPricing(persistedRows, PREVIEW_SNAPSHOTS);

  // A very different, unsaved draft sitting in the form -- must not leak in.
  const draftForm = typedFixedLabourMaterialsForm("999", "999", "99");

  const preview = resolveContractorPricingPreview(draftForm, {
    isDelivered: true,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });

  expect(preview).toBe(persistedPricing); // the exact same object, not a recomputation
  expect(preview.labourCents).toBe(50000);
  expect(preview.materialsCents).not.toBe(99900 * 1.99); // sanity: nothing derived from the draft
});

test("preview 5: the preview reuses calculateContractorPricing directly, with no second arithmetic path", () => {
  const form = typedFixedLabourMaterialsForm("100", "20", "25");
  const rows = toCanonicalRows(toPricingRequestPayload(form));
  const direct = calculateContractorPricing(rows, PREVIEW_SNAPSHOTS);

  const preview = resolveContractorPricingPreview(form, {
    isDelivered: false,
    persistedPricing: calculateContractorPricing([], PREVIEW_SNAPSHOTS),
    snapshots: PREVIEW_SNAPSHOTS,
  });

  expect(preview).toEqual(direct);
});

test("the editor binds every dollar display to the preview, not directly to saved pricing", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  expect(editor).toContain("resolveContractorPricingPreview");
  expect(editor).toContain(
    'Customer sees {money(preview.materialsCents)} at {form.markupPercent.trim() === "" ? "0" : form.markupPercent}% markup'
  );
  expect(editor).toContain('<Row label="Labour" value={money(preview.labourCents)} />');
  expect(editor).toContain('<Row label="Materials" value={money(preview.materialsCents)} />');
  expect(editor).toContain('<Row label="Subtotal" value={money(preview.subtotalCents)} />');
  expect(editor).toContain('<Row label="Tax" value={money(preview.taxCents)} />');
  expect(editor).toContain(
    '<Row label="Total" value={formatCentsAsCurrency(preview.totalCents, currency, false)} strong />'
  );
  expect(editor).toContain('<Row label="Deposit required" value={money(preview.depositCents)} />');
  expect(editor).toContain('<Row label="Balance on completion" value={money(preview.balanceCents)} />');
});

test("the editor passes isDelivered and the estimate's own deposit snapshot into the preview", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain("isDelivered: boolean;");
  expect(editor).toContain("depositPercent: number | null;");
  expect(editor).toContain("depositThresholdDollars: number | null;");
  expect(editor).toContain("snapshots: { taxRatePercent: initialTax.rate, depositPercent, depositThresholdDollars }");

  const page = readFileSync("app/estimates/[id]/page.tsx", "utf8");
  // The exact same resolved snapshot values the page already uses to compute
  // the server-side initialPricing -- not a second, independently-guessed
  // source of the deposit settings.
  // isDelivered picks the editor: a delivered estimate gets the plain editor
  // (isDelivered true), an undelivered draft gets ContractorPricingDraftEditor,
  // which always renders the editor with isDelivered={false}.
  expect(page).toContain("{isDelivered(estimate) ? (");
  expect(page).toContain("depositPercent={estimate.deposit_percent_snapshot}");
  expect(page).toContain("depositThresholdDollars={estimate.deposit_threshold_snapshot}");
});

// ── Exact Total formatting (production follow-up: CA$131 vs CA$131.25) ──────
//
// commit 4f2b25c ("Simplify estimate currency display") deliberately made
// every intermediate estimate figure a bare `$` and reserved the explicit
// `CA$`/`US$` prefix for the one grand Total -- but its own formatCurrency()
// still defaults `decimals` to 0 when a caller omits it, and the contractor
// editor's Total row omitted it, so the Total rendered as whole dollars
// (CA$131) instead of to the cent (CA$131.25) the customer-facing document
// already shows for the same figure. formatCentsAsCurrency() is now the one
// place both the customer document and the contractor editor get a cents
// figure formatted from -- not a third formatting path, a consolidation of
// the two that already existed (lib/customer-pricing.ts's own private
// `money`, and the editor's own local `money`).

test("formatCentsAsCurrency renders the exact cents, matching the customer-facing Total", () => {
  expect(formatCentsAsCurrency(13125, "cad", false)).toBe("CA$131.25");
  expect(formatCentsAsCurrency(13125, "cad", true)).toBe("$131.25");
  expect(formatCentsAsCurrency(0, "cad", false)).toBe("CA$0.00");
});

test("the contractor editor's Total row uses the same shared formatter as the customer document", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain("formatCentsAsCurrency");
  expect(editor).toContain(
    '<Row label="Total" value={formatCentsAsCurrency(preview.totalCents, currency, false)} strong />'
  );
  // The narrow fix: no arithmetic changed, no other formatter reintroduced.
  expect(editor).not.toContain("formatCurrency(");
  expect(editor).not.toContain("centsToDollars(");

  const customerPricing = readFileSync("lib/customer-pricing.ts", "utf8");
  expect(customerPricing).toContain('import { formatCentsAsCurrency as money, type Currency } from "./currency";');
  // The commit's own local money() duplicate is gone, not a second definition
  // kept alongside the shared one.
  expect(customerPricing).not.toContain("function money(");
});

// ── Draft completeness guidance (production follow-up, then a precedence fix) ─
//
// The dollar preview above already reads the live draft; the "Still needed
// before you can send this" guidance kept reading the last saved
// `pricing.missing` regardless, so a contractor who had already typed a
// complete price still saw "Add labour" until they hit Save. A first version
// of resolveContractorPricingGuidance() checked persisted completeness
// before draft completeness, which produced its own wrong answer: an
// estimate saved complete, then edited into an incomplete draft (e.g.
// labour removed), silently showed no guidance at all -- exactly backwards,
// since that draft cannot be sent as-is either. The live draft is now
// checked first for an undelivered estimate; persisted pricing is checked
// only once the draft itself is complete, to decide between "already fine"
// and "complete, but not saved yet." Delivered guidance takes an explicit
// `isDelivered` flag (the same one the pricing preview already carries) and
// never reads the draft at all, so "save-to-send" -- which would be actively
// wrong advice once repricing is rejected server-side -- cannot be reached.

const NO_ROWS: ContractorPricingRowInput[] = [];

test("guidance: undelivered, draft incomplete (persisted also incomplete) -> missing-items from the live draft", () => {
  const persistedPricing = calculateContractorPricing(NO_ROWS, PREVIEW_SNAPSHOTS); // fresh, nothing saved
  const preview = calculateContractorPricing(NO_ROWS, PREVIEW_SNAPSHOTS); // draft also empty: still incomplete

  const guidance = resolveContractorPricingGuidance({ isDelivered: false, preview, persistedPricing });

  expect(guidance).toEqual({
    kind: "missing-items",
    labels: ["Add labour", "Add materials, or enter 0"],
  });
});

test("guidance: undelivered, draft complete, persisted still incomplete -> save-to-send, no stale warnings", () => {
  const persistedPricing = calculateContractorPricing(NO_ROWS, PREVIEW_SNAPSHOTS); // nothing saved yet
  const draftForm = typedFixedLabourMaterialsForm("100", "20", "25");
  const preview = resolveContractorPricingPreview(draftForm, {
    isDelivered: false,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });

  const guidance = resolveContractorPricingGuidance({ isDelivered: false, preview, persistedPricing });

  expect(guidance).toEqual({ kind: "save-to-send" });
  // The exact stale warnings the production smoke found must not survive
  // alongside a complete live preview.
  expect(guidance).not.toEqual(
    expect.objectContaining({ labels: expect.arrayContaining(["Add labour"]) })
  );
});

test("guidance: undelivered, persisted complete and draft still complete -> none", () => {
  const persistedRows: ContractorPricingRowInput[] = [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 100, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 20, markup_percent: 25, description: "Materials", display_order: 1, taxable: true },
  ];
  const persistedPricing = calculateContractorPricing(persistedRows, PREVIEW_SNAPSHOTS);
  const draftForm = typedFixedLabourMaterialsForm("100", "20", "25"); // matches the saved state
  const preview = resolveContractorPricingPreview(draftForm, {
    isDelivered: false,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });

  const guidance = resolveContractorPricingGuidance({ isDelivered: false, preview, persistedPricing });

  expect(guidance).toEqual({ kind: "none" });
});

test("guidance precedence fix: undelivered, persisted complete but the unsaved draft has since become incomplete -> missing-items from the draft", () => {
  // The exact bug case: a previously-saved-complete estimate, then edited
  // (here: labour cleared back to no method) without saving. The old,
  // persisted-first precedence returned "none" here, silently hiding that
  // the current unsaved draft cannot be sent.
  const persistedRows: ContractorPricingRowInput[] = [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 100, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 20, markup_percent: 25, description: "Materials", display_order: 1, taxable: true },
  ];
  const persistedPricing = calculateContractorPricing(persistedRows, PREVIEW_SNAPSHOTS); // complete
  let form = initContractorPricingForm(persistedRows, GST_5, NO_DEFAULTS);
  form = { ...form, labourMethod: null, fixedAmount: "", hours: "", hourlyRate: "" }; // labour removed from the draft

  const preview = resolveContractorPricingPreview(form, {
    isDelivered: false,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });
  const guidance = resolveContractorPricingGuidance({ isDelivered: false, preview, persistedPricing });

  expect(preview.missing).toEqual(["labour-missing"]);
  expect(guidance).toEqual({ kind: "missing-items", labels: ["Add labour"] });
});

test("guidance: delivered, with a very different unsaved draft -> guidance still reflects persisted pricing only", () => {
  const persistedRows: ContractorPricingRowInput[] = [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 100, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 20, markup_percent: 25, description: "Materials", display_order: 1, taxable: true },
  ];
  const persistedPricing = calculateContractorPricing(persistedRows, PREVIEW_SNAPSHOTS); // complete
  const draftForm = initContractorPricingForm(NO_ROWS, GST_5, NO_DEFAULTS); // labourMethod null: incomplete draft

  const preview = resolveContractorPricingPreview(draftForm, {
    isDelivered: true,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });
  const guidance = resolveContractorPricingGuidance({ isDelivered: true, preview, persistedPricing });

  expect(guidance).toEqual({ kind: "none" }); // persisted is complete; the incomplete draft never surfaces
  expect(preview).toBe(persistedPricing);
});

test("guidance: delivered, persisted-incomplete contrived case -> persisted missing labels, never draft labels", () => {
  // Contrived (a delivered estimate should already be complete by
  // construction, per the invariant below), but proves the rule holds
  // structurally rather than by coincidence: the delivered branch reads
  // persistedPricing.missing directly, never the draft's.
  const persistedPricing = calculateContractorPricing(NO_ROWS, PREVIEW_SNAPSHOTS); // incomplete
  const draftForm = typedFixedLabourMaterialsForm("100", "20", "25"); // a complete, very different draft

  const preview = resolveContractorPricingPreview(draftForm, {
    isDelivered: true,
    persistedPricing,
    snapshots: PREVIEW_SNAPSHOTS,
  });
  const guidance = resolveContractorPricingGuidance({ isDelivered: true, preview, persistedPricing });

  expect(preview).toBe(persistedPricing);
  expect(guidance).toEqual({
    kind: "missing-items",
    labels: ["Add labour", "Add materials, or enter 0"],
  });
});

test("guidance: delivered state never returns save-to-send", () => {
  // Complete and incomplete persisted pricing, each paired with a very
  // different complete draft -- neither combination may ever suggest saving,
  // since a delivered estimate cannot be repriced at all.
  const completeRows: ContractorPricingRowInput[] = [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 100, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 20, markup_percent: 25, description: "Materials", display_order: 1, taxable: true },
  ];
  const completePersisted = calculateContractorPricing(completeRows, PREVIEW_SNAPSHOTS);
  const incompletePersisted = calculateContractorPricing(NO_ROWS, PREVIEW_SNAPSHOTS);
  const draftForm = typedFixedLabourMaterialsForm("999", "999", "99");

  for (const persistedPricing of [completePersisted, incompletePersisted]) {
    const preview = resolveContractorPricingPreview(draftForm, {
      isDelivered: true,
      persistedPricing,
      snapshots: PREVIEW_SNAPSHOTS,
    });
    const guidance = resolveContractorPricingGuidance({ isDelivered: true, preview, persistedPricing });
    expect(guidance.kind).not.toBe("save-to-send");
  }
});

test("the editor binds its guidance display to the one derived guidance value, nowhere else", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  expect(editor).toContain(
    "const guidance = resolveContractorPricingGuidance({ isDelivered, preview, persistedPricing: pricing });"
  );
  expect(editor).toContain('{guidance.kind !== "none" && (');
  expect(editor).toContain('guidance.kind === "missing-items"');
  expect(editor).toContain("{guidance.labels.map((reason) => (");
  expect(editor).toContain("Save pricing to enable sending.");

  // No independent second read of missing/completeness anywhere in the file.
  expect(editor).not.toContain("pricing.missing");
  expect(editor).not.toContain("missingLabels(");
});

test("an unsaved complete draft alone never activates Send: gating still requires the saved PRICING_CHANGE_EVENT", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  const actions = readFileSync("app/components/estimate-actions.tsx", "utf8");

  // The dispatch only ever fires from inside save()'s success branch, using
  // the server response's own `complete` field -- guidance reading the draft
  // does not add a second path that could fire it from typing alone.
  const dispatchIndex = editor.indexOf("window.dispatchEvent(");
  expect(dispatchIndex).toBeGreaterThan(-1);
  const saveSuccessIndex = editor.indexOf("setPricing(data.pricing);");
  expect(saveSuccessIndex).toBeGreaterThan(-1);
  expect(saveSuccessIndex).toBeLessThan(dispatchIndex);
  expect(editor.slice(saveSuccessIndex, dispatchIndex + 1)).not.toContain("resolveContractorPricingGuidance");

  // Send's own gate is the persisted-driven liveComplete/sendBlocked pair,
  // unrelated to anything this fix touched.
  expect(actions).toContain("const sendBlocked = !liveComplete;");
});

// ── Add Pricing lands on the pricing section, not the top of the page ───────

test("the pricing section carries a stable anchor with a scroll margin", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain('<div id="pricing" ref={pricingRef} className="mb-4 flex flex-col gap-6 scroll-mt-6">');
});

test("the healthy Add Pricing action on /new no longer links to /estimates/{id} -- it scrolls the same page instead", () => {
  // Superseded by same-page pricing (production found a black route-
  // transition flash tapping the old #pricing link on Android Chrome): the
  // healthy-path Add Pricing action is now a same-page scroll button, not a
  // Link. Six /estimates/${savedEstimateId} hrefs remain on /new: Continue
  // to Send and the legacy/delivered "View Estimate" links (inline card and
  // sticky bar each, plain detail-page URL, no hash), and two exceptional
  // #pricing fallbacks (inline card and sticky bar), shown only if the
  // authoritative pricing GET fails.
  const newPage = readFileSync("app/new/page.tsx", "utf8");
  const hrefs = [...newPage.matchAll(/href=\{`\/estimates\/\$\{savedEstimateId\}([^`]*)`\}/g)].map((m) => m[1]);
  expect(hrefs.sort()).toEqual(["", "", "", "", "#pricing", "#pricing"]);
});

// ── Add Pricing scroll fallback (production follow-up: Android Chrome) ──────
//
// Plain browser hash navigation to /estimates/{id}#pricing proved unreliable
// on Android Chrome for this client-rendered section, so the editor scrolls
// there itself on mount when the hash asked for it. shouldScrollToPricing()
// is the one decision behind that: this proves the decision only, not that
// the effect is wired to the element correctly, that scrollIntoView() is
// actually called, that the once-per-mount guard holds in the rendered app,
// or that Android Chrome lands at the correct position -- those require the
// production phone check, not a unit-safe test.

test("shouldScrollToPricing decides only from the #pricing hash", () => {
  expect(shouldScrollToPricing("#pricing")).toBe(true);
  expect(shouldScrollToPricing("")).toBe(false);
  expect(shouldScrollToPricing(undefined)).toBe(false);
  expect(shouldScrollToPricing("#other")).toBe(false);
});

// ── Phase 2 slice 4: saved line-item acceptance, editing and reload ────────
//
// specs/contractor-owned-pricing.md's Phase 2 slice 4 instructions. Suggestion
// generation and ranking are already fully covered by pricebook-suggestions.
// spec.ts; these cases cover what happens once the contractor accepts one:
// mode switching, the confirmed-item draft, reload reconstruction of
// persisted 'ea' pairs, and the live-preview/payload pipeline.

function lineItemRow(overrides: Partial<ContractorPricingRowInput>): ContractorPricingRowInput {
  return {
    item_type: "labour",
    unit: "ea",
    quantity: 2,
    unit_price: 145,
    markup_percent: null,
    description: "Quarter-turn shutoff valve replacement",
    display_order: 0,
    taxable: true,
    ...overrides,
  };
}

function pairRows(overrides: {
  description?: string;
  quantity?: number;
  labourPrice?: number;
  materialPrice?: number;
  taxable?: boolean;
  displayOrder?: number;
} = {}): ContractorPricingRowInput[] {
  const {
    description = "Quarter-turn shutoff valve replacement",
    quantity = 2,
    labourPrice = 145,
    materialPrice = 18,
    taxable = true,
    displayOrder = 0,
  } = overrides;
  return [
    lineItemRow({ description, quantity, unit_price: labourPrice, display_order: displayOrder, taxable }),
    lineItemRow({
      item_type: "material",
      description,
      quantity,
      unit_price: materialPrice,
      markup_percent: 0,
      display_order: displayOrder + 1,
      taxable,
    }),
  ];
}

// ── Reload reconstruction ───────────────────────────────────────────────────

test("39: a valid adjacent ea labour/material pair reconstructs one confirmed item", () => {
  const result = reconstructConfirmedItems(pairRows());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    description: "Quarter-turn shutoff valve replacement",
    quantity: "2",
    labourUnitPrice: "145",
    materialUnitPrice: "18",
    taxable: true,
  });
});

test("40: two valid pairs reconstruct two confirmed items", () => {
  const rows = [
    ...pairRows({ description: "Kitchen faucet replacement", quantity: 1, labourPrice: 325, materialPrice: 0, displayOrder: 0 }),
    ...pairRows({ description: "Braided supply line replacement", quantity: 2, labourPrice: 55, materialPrice: 15, displayOrder: 2 }),
  ];
  const result = reconstructConfirmedItems(rows);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.items.map((item) => item.description)).toEqual([
    "Kitchen faucet replacement",
    "Braided supply line replacement",
  ]);
});

test("41: two identical descriptions in separate adjacent pairs remain separate items", () => {
  const rows = [
    ...pairRows({ description: "Shutoff valve replacement", quantity: 1, displayOrder: 0 }),
    ...pairRows({ description: "Shutoff valve replacement", quantity: 3, displayOrder: 2 }),
  ];
  const result = reconstructConfirmedItems(rows);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.items).toHaveLength(2);
  expect(result.items.map((item) => item.quantity)).toEqual(["1", "3"]);
});

test("42: a malformed orphan ea labour row refuses reconstruction", () => {
  const result = reconstructConfirmedItems([lineItemRow({})]);
  expect(result).toEqual({ ok: false });
});

test("43: a malformed orphan ea material row refuses reconstruction", () => {
  const result = reconstructConfirmedItems([
    lineItemRow({ item_type: "material", markup_percent: 0 }),
  ]);
  expect(result).toEqual({ ok: false });
});

test("44: a mismatched pair (quantity, description or taxable) refuses reconstruction", () => {
  const mismatchedQuantity = pairRows();
  mismatchedQuantity[1] = { ...mismatchedQuantity[1], quantity: 3 };
  expect(reconstructConfirmedItems(mismatchedQuantity)).toEqual({ ok: false });

  const mismatchedDescription = pairRows();
  mismatchedDescription[1] = { ...mismatchedDescription[1], description: "Something else" };
  expect(reconstructConfirmedItems(mismatchedDescription)).toEqual({ ok: false });

  const mismatchedTaxable = pairRows();
  mismatchedTaxable[1] = { ...mismatchedTaxable[1], taxable: false };
  expect(reconstructConfirmedItems(mismatchedTaxable)).toEqual({ ok: false });

  // An odd count is itself a malformed pairing.
  expect(reconstructConfirmedItems([lineItemRow({}), lineItemRow({}), lineItemRow({})])).toEqual({ ok: false });

  // Swapped order (material before labour) never fits the pairing shape.
  const swapped = [
    lineItemRow({ item_type: "material", markup_percent: 0, display_order: 0 }),
    lineItemRow({ item_type: "labour", display_order: 1 }),
  ];
  expect(reconstructConfirmedItems(swapped)).toEqual({ ok: false });
});

// ── Pre-push audit fix: the material row's markup_percent = 0 invariant ────
//
// toCanonicalRows() always writes a confirmed item's material row with an
// explicit markup_percent of 0 -- never null, never a real markup --
// because tpe_pricebook_items.material_price is already a final selling
// price. A material 'ea' row carrying anything else was not written by this
// feature and must not be silently treated as a valid pair (it would either
// apply a markup a second time, or paper over unknown/corrupt data as 0).

test("a material row with a non-zero, null or NaN markup_percent refuses reconstruction", () => {
  const nonZero = pairRows();
  nonZero[1] = { ...nonZero[1], markup_percent: 20 };
  expect(reconstructConfirmedItems(nonZero)).toEqual({ ok: false });

  const nullMarkup = pairRows();
  nullMarkup[1] = { ...nullMarkup[1], markup_percent: null };
  expect(reconstructConfirmedItems(nullMarkup)).toEqual({ ok: false });

  const nanMarkup = pairRows();
  nanMarkup[1] = { ...nanMarkup[1], markup_percent: NaN };
  expect(reconstructConfirmedItems(nanMarkup)).toEqual({ ok: false });

  // Explicit 0 (the only value toCanonicalRows() ever writes) still passes.
  expect(reconstructConfirmedItems(pairRows()).ok).toBe(true);
});

test("45: generic rows still reconstruct existing generic mode unchanged, with no confirmed items", () => {
  const result = reconstructConfirmedItems([HOURLY_ROW, MATERIALS_ROW]);
  expect(result).toEqual({ ok: true, items: [] });

  const form = initContractorPricingForm([HOURLY_ROW, MATERIALS_ROW], GST_5, DEFAULTS);
  expect(form.confirmedItems).toEqual([]);
  expect(form.pricingAttentionNeeded).toBe(false);
  expect(form.labourMethod).toBe("hourly");
});

test("'ea' rows coexisting with a generic labour/material row refuse reconstruction (Option C on reload)", () => {
  const result = reconstructConfirmedItems([...pairRows(), HOURLY_ROW]);
  expect(result).toEqual({ ok: false });
});

test("initContractorPricingForm enters a pricing-attention state on malformed rows, with no editable draft manufactured", () => {
  const form = initContractorPricingForm([lineItemRow({})], GST_5, DEFAULTS);

  expect(form.pricingAttentionNeeded).toBe(true);
  expect(form.confirmedItems).toEqual([]);
  expect(form.labourMethod).toBeNull();
  expect(form.materialsCost).toBe("");
  expect(form.charges).toEqual([]);
});

test("initContractorPricingForm reconstructs confirmed items directly from valid persisted pairs", () => {
  const form = initContractorPricingForm(pairRows(), GST_5, DEFAULTS);

  expect(form.pricingAttentionNeeded).toBe(false);
  expect(form.confirmedItems).toHaveLength(1);
  expect(form.labourMethod).toBeNull(); // no generic labour row when using confirmed items
  expect(toPricingRequestPayload(form).lineItems).toEqual([
    {
      description: "Quarter-turn shutoff valve replacement",
      quantity: 2,
      labourUnitPrice: 145,
      materialUnitPrice: 18,
      taxable: true,
    },
  ]);
});

// ── Acceptance, editing, removal, duplicate prevention ──────────────────────

test("21 and 22: an accepted item starts at quantity 1 with labour/material/taxable copied from the resolved values", () => {
  const form = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: false,
  });

  expect(form.confirmedItems).toHaveLength(1);
  expect(form.confirmedItems[0]).toMatchObject({
    description: "Kitchen faucet replacement",
    quantity: "1",
    labourUnitPrice: "325",
    materialUnitPrice: "0",
    taxable: false,
  });
});

test("23, 24, 25 and 26: description, quantity, labour price and material price are all editable", () => {
  let form = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: true,
  });
  const id = form.confirmedItems[0].id;

  form = updateConfirmedItem(form, id, "description", "Kitchen faucet replacement (premium)");
  form = updateConfirmedItem(form, id, "quantity", "3");
  form = updateConfirmedItem(form, id, "labourUnitPrice", "400");
  form = updateConfirmedItem(form, id, "materialUnitPrice", "50");

  expect(form.confirmedItems[0]).toMatchObject({
    description: "Kitchen faucet replacement (premium)",
    quantity: "3",
    labourUnitPrice: "400",
    materialUnitPrice: "50",
  });
});

test("27: Remove removes only that confirmed item, leaving other confirmed items, charges and tax untouched", () => {
  let form = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: true,
  });
  form = acceptSuggestedItem(form, {
    description: "Braided supply line replacement",
    labourUnitPrice: 55,
    materialUnitPrice: 15,
    taxable: true,
  });
  form = addCharge(form);
  form = updateCharge(form, form.charges[0].id, "description", "Permit");
  form = updateCharge(form, form.charges[0].id, "amount", "150");
  form = editTax(form, "taxRate", "13");

  const [first, second] = form.confirmedItems;
  form = removeConfirmedItem(form, first.id);

  expect(form.confirmedItems).toHaveLength(1);
  expect(form.confirmedItems[0].id).toBe(second.id);
  expect(form.charges).toHaveLength(1);
  expect(form.charges[0].description).toBe("Permit");
  expect(form.taxRate).toBe("13");
});

test("28: removing the last confirmed item returns to generic mode without restoring the discarded generic values", () => {
  let form = typedFixedLabourMaterialsForm("200", "50", "15"); // real generic values entered
  form = acceptSuggestedItem(form, {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: true,
  });
  // Generic values were cleared by acceptance, not just hidden.
  expect(form.labourMethod).toBeNull();
  expect(form.fixedAmount).toBe("");
  expect(form.materialsCost).toBe("");

  form = removeConfirmedItem(form, form.confirmedItems[0].id);

  expect(form.confirmedItems).toEqual([]);
  // Back to generic mode, but genuinely empty -- the old $200/$50/15% values
  // are gone, not restored from a hidden backup.
  expect(form.labourMethod).toBeNull();
  expect(form.fixedAmount).toBe("");
  expect(form.materialsCost).toBe("");
  expect(toPricingRequestPayload(form).labour).toBeNull();
  expect(toPricingRequestPayload(form).materials).toBeNull();
});

test("29 and 30: the editor prevents the same suggestion being added twice by removing it from the visible list; quantity is the only multiples mechanism", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  // Acceptance removes the just-accepted suggestion from local state, the
  // structural mechanism that makes a second tap on the same suggestion
  // impossible (it is no longer rendered).
  expect(editor).toContain(
    "setSuggestions((current) => current.filter((candidate) => candidate.id !== suggestion.id));"
  );

  // A second instance of the same saved item is expressed as quantity, not a
  // second confirmed item: acceptSuggestedItem() always appends at quantity 1
  // and there is no merge-by-description path anywhere in this module.
  const form = readFileSync("lib/contractor-pricing-form.ts", "utf8");
  expect(form).not.toContain("find((item) => item.description ===");
});

// ── Pre-push audit fix: a resolve 404 also removes the now-stale suggestion ─
//
// A resolve failure must never clear generic pricing or add a confirmed item
// (already covered by test 20 above). This is the separate, narrower
// question the audit raised: once the resolve endpoint says an item is
// unavailable (404 -- inactive or deleted), it will never resolve again, so
// the suggestion must come off the visible list right then, not just on a
// later successful accept of a different one. A non-404 failure (network,
// 401, 500) is different: the item may still be genuinely resolvable, so it
// must stay in the list for a retry.

test("a 404 (item unavailable) resolve failure removes the stale suggestion from the local list; other failures leave it in place for retry", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  const fnStart = editor.indexOf("async function acceptSuggestion(");
  const fnEnd = editor.indexOf("\n  }\n", editor.indexOf("finally {", fnStart));
  const fn = editor.slice(fnStart, fnEnd);

  const ifOkIndex = fn.indexOf("if (!response.ok || !data.item)");
  const statusCheckIndex = fn.indexOf("response.status === 404", ifOkIndex);
  const throwIndex = fn.indexOf("throw new Error", ifOkIndex);
  expect(ifOkIndex).toBeGreaterThan(-1);
  expect(statusCheckIndex, "the failure branch checks for 404 specifically").toBeGreaterThan(ifOkIndex);
  expect(statusCheckIndex).toBeLessThan(throwIndex); // the removal check runs before the error is thrown

  // Exactly the removal filter, present inside the 404-specific branch, not
  // unconditionally on every failure.
  const failureBranch = fn.slice(ifOkIndex, throwIndex);
  expect(failureBranch).toContain(
    "setSuggestions((current) => current.filter((candidate) => candidate.id !== suggestion.id));"
  );
  expect(failureBranch).toContain("if (response.status === 404) {");
});

// ── Mode-switch confirmation semantics ──────────────────────────────────────

test("12: a selected labour method with no actual amount does not count as entered generic pricing", () => {
  let form = chooseLabourMethod(initContractorPricingForm([], GST_5, DEFAULTS), "hourly", DEFAULTS);
  expect(form.hourlyRate).toBe("95"); // business default prefilled, but no hours typed
  expect(hasEnteredGenericPricing(form)).toBe(false);

  form = chooseLabourMethod(initContractorPricingForm([], GST_5, DEFAULTS), "fixed", DEFAULTS);
  expect(hasEnteredGenericPricing(form)).toBe(false);
});

test("13: a default material markup with no materials cost does not count as entered generic pricing", () => {
  const form = initContractorPricingForm([], GST_5, DEFAULTS);
  expect(form.markupPercent).toBe("20"); // business default, no cost typed
  expect(hasEnteredGenericPricing(form)).toBe(false);
});

test("14: an actual labour value counts as entered generic pricing", () => {
  let form = chooseLabourMethod(initContractorPricingForm([], GST_5, DEFAULTS), "hourly", DEFAULTS);
  form = { ...form, hours: "6" };
  expect(hasEnteredGenericPricing(form)).toBe(true);

  let fixed = chooseLabourMethod(initContractorPricingForm([], GST_5, DEFAULTS), "fixed", DEFAULTS);
  fixed = { ...fixed, fixedAmount: "0" }; // an explicit $0 still counts as entered
  expect(hasEnteredGenericPricing(fixed)).toBe(true);
});

test("15: an actual materials value counts as entered generic pricing", () => {
  const form = { ...initContractorPricingForm([], GST_5, DEFAULTS), materialsCost: "0" };
  expect(hasEnteredGenericPricing(form)).toBe(true);
});

test("11: accepting the first suggestion into empty generic pricing needs no warning", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain("if (form.confirmedItems.length === 0 && hasEnteredGenericPricing(form)) {");
  expect(editor).toContain("setPendingSuggestionId(suggestion.id);");
  expect(editor).toContain("void acceptSuggestion(suggestion);");
});

test("the mode-switch confirmation copy names what is kept and what is replaced", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain(
    "Use saved line items instead? This will replace your current Labour and Materials values."
  );
  expect(editor).toContain("Other charges and tax will stay.");
  expect(editor).toContain("Use saved line items");
  expect(editor).toContain("Cancel");
  expect(editor).toContain("cancelPendingSuggestion");
});

test("16, 17, 18 and 19: Cancel preserves every generic value and adds nothing; Confirm clears only Labour/Materials and preserves charges and tax", () => {
  const before = typedFixedLabourMaterialsForm("200", "50", "15");
  const withCharge = { ...addCharge(before) };
  const withChargeFilled = updateCharge(withCharge, withCharge.charges[0].id, "description", "Permit");

  // Cancel: modelled as simply not calling acceptSuggestedItem at all -- the
  // form after cancellation is byte-identical to the form before the tap.
  expect(withChargeFilled.confirmedItems).toEqual([]);
  expect(withChargeFilled.fixedAmount).toBe("200");
  expect(withChargeFilled.materialsCost).toBe("50");

  // Confirm: acceptSuggestedItem clears Labour/Materials only.
  const confirmed = acceptSuggestedItem(withChargeFilled, {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: true,
  });
  expect(confirmed.labourMethod).toBeNull();
  expect(confirmed.fixedAmount).toBe("");
  expect(confirmed.materialsCost).toBe("");
  expect(confirmed.markupPercent).toBe("");
  // Other charges preserved.
  expect(confirmed.charges).toHaveLength(1);
  expect(confirmed.charges[0].description).toBe("Permit");
});

test("20: a resolve failure after confirmation never clears generic pricing or adds a confirmed item", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  // acceptSuggestion() only mutates `form` inside the try block's success
  // path -- setForm(acceptSuggestedItem(...)) is the only call to
  // acceptSuggestedItem in the whole file, and it happens after the response
  // is confirmed ok and to carry an item.
  const acceptCalls = [...editor.matchAll(/acceptSuggestedItem\(/g)];
  expect(acceptCalls).toHaveLength(1);

  const fnStart = editor.indexOf("async function acceptSuggestion(");
  const fnEnd = editor.indexOf("\n  }\n", editor.indexOf("finally {", fnStart));
  const fn = editor.slice(fnStart, fnEnd);

  const ifOkIndex = fn.indexOf("if (!response.ok || !data.item)");
  const acceptIndex = fn.indexOf("acceptSuggestedItem");
  const throwIndex = fn.indexOf("throw new Error", ifOkIndex);
  expect(ifOkIndex).toBeGreaterThan(-1);
  expect(throwIndex).toBeGreaterThan(ifOkIndex);
  expect(acceptIndex).toBeGreaterThan(throwIndex); // form mutation is unreachable from the thrown branch

  // The catch clause only ever sets the error message and never touches form.
  const catchStart = fn.indexOf("} catch (error) {");
  const catchEnd = fn.indexOf("} finally {", catchStart);
  const catchBody = fn.slice(catchStart, catchEnd);
  expect(catchBody).not.toContain("setForm");
});

// ── Live preview / payload pipeline ─────────────────────────────────────────

const LINE_ITEM_SNAPSHOTS = { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null };

test("31 and 38: confirmed items flow through the existing request/canonical/calculator pipeline, the same PUT contract as everything else", () => {
  let form = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Quarter-turn shutoff valve replacement",
    labourUnitPrice: 145,
    materialUnitPrice: 18,
    taxable: true,
  });
  form = updateConfirmedItem(form, form.confirmedItems[0].id, "quantity", "2");

  const payload = payloadOf(form); // asserts the route would accept it
  expect(payload.labour).toBeNull();
  expect(payload.materials).toBeNull();
  expect(payload.lineItems).toEqual([
    { description: "Quarter-turn shutoff valve replacement", quantity: 2, labourUnitPrice: 145, materialUnitPrice: 18, taxable: true },
  ]);

  const rows = toCanonicalRows(payload);
  const direct = calculateContractorPricing(rows, LINE_ITEM_SNAPSHOTS);
  const preview = resolveContractorPricingPreview(form, {
    isDelivered: false,
    persistedPricing: calculateContractorPricing([], LINE_ITEM_SNAPSHOTS),
    snapshots: LINE_ITEM_SNAPSHOTS,
  });
  expect(preview).toEqual(direct);
  // 2 x $145 labour + 2 x $18 material = $290 + $36 = $326, taxed at 5%.
  expect(preview.labourCents).toBe(29000);
  expect(preview.materialsCents).toBe(3600);
  expect(preview.taxCents).toBe(1630);
});

test("32, 33 and 34: editing quantity, labour price or material price immediately changes the live preview", () => {
  const base = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Quarter-turn shutoff valve replacement",
    labourUnitPrice: 145,
    materialUnitPrice: 18,
    taxable: true,
  });
  const id = base.confirmedItems[0].id;

  function previewOf(form: typeof base) {
    return resolveContractorPricingPreview(form, {
      isDelivered: false,
      persistedPricing: calculateContractorPricing([], LINE_ITEM_SNAPSHOTS),
      snapshots: LINE_ITEM_SNAPSHOTS,
    });
  }

  const beforeCents = previewOf(base).subtotalCents;

  const quantityChanged = updateConfirmedItem(base, id, "quantity", "3");
  expect(previewOf(quantityChanged).subtotalCents).not.toBe(beforeCents);

  const labourChanged = updateConfirmedItem(base, id, "labourUnitPrice", "200");
  expect(previewOf(labourChanged).subtotalCents).not.toBe(beforeCents);

  const materialChanged = updateConfirmedItem(base, id, "materialUnitPrice", "40");
  expect(previewOf(materialChanged).subtotalCents).not.toBe(beforeCents);
});

test("35: a saved-item material row still gets markup_percent = 0, through the same encoding as the request contract", () => {
  const form = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 50,
    taxable: true,
  });
  const rows = toCanonicalRows(toPricingRequestPayload(form));
  const materialRow = rows.find((row) => row.item_type === "material");
  expect(materialRow?.markup_percent).toBe(0);
});

test("36: a zero-valued labour or material counterpart on a confirmed item remains valid", () => {
  const zeroMaterial = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: true,
  });
  expect(payloadOf(zeroMaterial).lineItems![0]).toMatchObject({ materialUnitPrice: 0 });

  const zeroLabour = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Materials-only allowance",
    labourUnitPrice: 0,
    materialUnitPrice: 75,
    taxable: true,
  });
  expect(payloadOf(zeroLabour).lineItems![0]).toMatchObject({ labourUnitPrice: 0 });
});

test("37: a non-taxable confirmed item excludes both its labour and material amounts from the taxable subtotal, but keeps them in subtotal", () => {
  const form = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 50,
    taxable: false,
  });
  const rows = toCanonicalRows(toPricingRequestPayload(form));
  const pricing = calculateContractorPricing(
    rows.map((row) => ({
      item_type: row.item_type,
      unit: row.unit,
      quantity: row.quantity,
      unit_price: row.unit_price,
      markup_percent: row.markup_percent,
      taxable: row.taxable,
    })),
    LINE_ITEM_SNAPSHOTS
  );

  expect(pricing.subtotalCents).toBe(37500); // 325 + 50 = 375.00
  expect(pricing.taxCents).toBe(0); // excluded from tax entirely
});

// ── Pre-push follow-up: the "needs attention" gate reaches every delivery
// surface, not just the editor (withReconstructionGate) ─────────────────────
//
// reconstructConfirmedItems() already refuses to interpret malformed
// persisted 'ea' rows and puts the client editor into pricingAttentionNeeded
// -- but app/estimates/[id]/page.tsx independently computed its own
// completeness/total from the same raw rows via calculateContractorPricing,
// which has no knowledge of that invariant, so a malformed estimate could
// still look complete and be sendable. withReconstructionGate() is the one
// shared function that closes that gap: lib/estimate-pricing-server.ts's
// contractorPricingCompleteness() (used by all three server delivery
// routes) and app/estimates/[id]/page.tsx's own SSR completeness
// computation both call it now, never a second reimplementation.
//
// Deliberately kept in this plain module, not lib/estimate-pricing-
// server.ts, specifically so it can be unit-tested here: that file is
// `import "server-only"`, which throws when imported outside Next's own
// bundler (confirmed directly: `Cannot find module 'server-only'` under
// Playwright's plain Node module resolution), so nothing defined there can
// be exercised by a spec in this suite.

const DELIVERY_SNAPSHOTS = { taxRatePercent: 5, depositPercent: 10, depositThresholdDollars: 50 };

test("contractor_pricing + malformed 'ea' pair (material markup != 0): not delivery-ready", () => {
  const malformed = pairRows();
  malformed[1] = { ...malformed[1], markup_percent: 20 };

  const basePricing = calculateContractorPricing(
    malformed.map((row) => ({
      item_type: row.item_type,
      unit: row.unit,
      quantity: row.quantity,
      unit_price: row.unit_price,
      markup_percent: row.markup_percent,
      taxable: row.taxable,
    })),
    DELIVERY_SNAPSHOTS
  );
  // The plain calculator has no knowledge of the pairing invariant: a
  // labour-type row and a material-type row are present, so it reports
  // complete on its own -- this is the exact gap the gate closes.
  expect(basePricing.complete).toBe(true);

  const gated = withReconstructionGate(basePricing, malformed);
  expect(gated.complete).toBe(false);
});

test("contractor_pricing + valid saved-item pair: delivery-ready", () => {
  const valid = pairRows();
  const basePricing = calculateContractorPricing(
    valid.map((row) => ({
      item_type: row.item_type,
      unit: row.unit,
      quantity: row.quantity,
      unit_price: row.unit_price,
      markup_percent: row.markup_percent,
      taxable: row.taxable,
    })),
    DELIVERY_SNAPSHOTS
  );
  expect(basePricing.complete).toBe(true);

  const gated = withReconstructionGate(basePricing, valid);
  expect(gated.complete).toBe(true);
  expect(gated).toEqual(basePricing); // unchanged object shape, not just the flag
});

test("contractor_pricing + valid generic Labour/Materials with charges and tax: delivery-ready", () => {
  const genericRows: ContractorPricingRowInput[] = [
    HOURLY_ROW,
    MATERIALS_ROW,
    row({ item_type: "other", description: "Permit", unit: null, unit_price: 150, markup_percent: null, display_order: 2 }),
  ];
  const basePricing = calculateContractorPricing(
    genericRows.map((r) => ({
      item_type: r.item_type,
      unit: r.unit,
      quantity: r.quantity,
      unit_price: r.unit_price,
      markup_percent: r.markup_percent,
      taxable: r.taxable,
    })),
    DELIVERY_SNAPSHOTS
  );
  expect(basePricing.complete).toBe(true);

  const gated = withReconstructionGate(basePricing, genericRows);
  expect(gated.complete).toBe(true);
});

test("structured + 'ea' rows with item_type 'other' and markup_percent null (real production shape): the gate is never reached, and would misfire if it were", () => {
  // The exact shape the production trace found: 23 rows across 7 structured
  // estimates, unit='ea', item_type='other', markup_percent NULL. Proven
  // here as a fact about this function (it is not this invariant's shape at
  // all -- item_type 'other' can never satisfy the labour/material pairing
  // check), to justify why every call site below must classify first.
  const structuredEaRows: ContractorPricingRowInput[] = [
    row({ item_type: "other", unit: "ea", quantity: 1, unit_price: 50, markup_percent: null, description: "Add-on", display_order: 0 }),
  ];
  expect(reconstructConfirmedItems(structuredEaRows)).toEqual({ ok: false });

  // Every real call site classifies pricing_source first and only calls
  // withReconstructionGate for 'contractor_pricing' -- so this shape, which
  // only ever occurs on 'structured' estimates per the verified production
  // read, is never actually passed to it.
  const server = readFileSync("lib/estimate-pricing-server.ts", "utf8");
  const completenessStart = server.indexOf("export async function contractorPricingCompleteness(");
  expect(completenessStart).toBeGreaterThan(-1);
  expect(server.slice(completenessStart)).toContain("withReconstructionGate(pricing, rows)");

  for (const routePath of ["app/api/send-sms/route.ts", "app/api/send-email/route.ts", "app/api/estimates/route.ts"]) {
    const route = readFileSync(routePath, "utf8");
    expect(route).toContain("classifyEstimate(");
    expect(route).toContain("contractorPricingCompleteness(");
    // Classification runs before the completeness call reaches it -- the
    // completeness call must be textually inside the contractor_pricing
    // branch, not a plain top-level call.
    const classifyIndex = route.indexOf('=== "contractor_pricing"');
    const completenessIndex = route.indexOf("contractorPricingCompleteness(", classifyIndex);
    expect(classifyIndex, `${routePath} classifies before completeness`).toBeGreaterThan(-1);
    expect(completenessIndex, `${routePath} calls completeness after classification`).toBeGreaterThan(classifyIndex);
  }

  const page = readFileSync("app/estimates/[id]/page.tsx", "utf8");
  expect(page).toContain("import { withReconstructionGate } from \"@/lib/contractor-pricing-form\";");
  const gateCallIndex = page.indexOf("withReconstructionGate(");
  const isContractorPricingTernary = page.indexOf("const contractorPricing = isContractorPricing");
  expect(isContractorPricingTernary).toBeGreaterThan(-1);
  expect(gateCallIndex).toBeGreaterThan(isContractorPricingTernary);
  expect(gateCallIndex).toBeLessThan(page.indexOf(": null;", isContractorPricingTernary));
});

test("already-delivered estimate: readiness is unchanged (no 'ea' rows means the gate is a no-op, exactly today's behaviour)", () => {
  // Per the verified production read, zero contractor_pricing estimates
  // currently have any 'ea' rows -- this proves that fact holds structurally
  // for the ordinary delivered shape (generic labour/materials, no saved
  // items), not just as an observation about today's data.
  const deliveredRows: ContractorPricingRowInput[] = [HOURLY_ROW, MATERIALS_ROW];
  const basePricing = calculateContractorPricing(
    deliveredRows.map((r) => ({
      item_type: r.item_type,
      unit: r.unit,
      quantity: r.quantity,
      unit_price: r.unit_price,
      markup_percent: r.markup_percent,
      taxable: r.taxable,
    })),
    DELIVERY_SNAPSHOTS
  );

  const gated = withReconstructionGate(basePricing, deliveredRows);
  expect(gated).toEqual(basePricing);

  // The resend path (already delivered) still calls the exact same shared
  // completeness check as first delivery -- not a second, delivered-only
  // code path that could disagree with it.
  const sendSms = readFileSync("app/api/send-sms/route.ts", "utf8");
  expect(sendSms).not.toContain("isDelivered(estimate)) {\n    return");
  const completenessCallIndex = sendSms.indexOf("contractorPricingCompleteness(");
  expect(completenessCallIndex).toBeGreaterThan(-1);
});

test("app/estimates/[id]/page.tsx's estimateComplete now binds to the gated contractorPricing, not the ungated contractorDocument.ready", () => {
  const page = readFileSync("app/estimates/[id]/page.tsx", "utf8");

  expect(page).toContain(
    "const estimateComplete = contractorPricing ? contractorPricing.complete : estimateTotal > 0;"
  );
  expect(page).not.toContain(
    "const estimateComplete = contractorDocument ? contractorDocument.ready : estimateTotal > 0;"
  );

  // Customer rendering (the document, PDF and total shown) is untouched:
  // customerSummary and estimateTotal still bind to contractorDocument
  // exactly as before -- only the send-readiness signal moved.
  expect(page).toContain(
    'const customerSummary = contractorDocument\n    ? contractorDocument.ready\n      ? contractorDocument.document'
  );
  expect(page).toContain(
    'const estimateTotal = contractorDocument\n    ? contractorDocument.ready\n      ? contractorDocument.totalCents / 100'
  );
});

// ── /new sticky Save Pricing CTA (dirty-after-save tracking) ───────────────
//
// specs behind this block: reconstructConfirmedItems and the reconstruction
// gate are unaffected -- this is purely about the editor's own save
// pending/error/dirty state and how /new mirrors a read-only projection of
// it to choose its sticky call-to-action, without ever computing that
// projection itself.

function completeGst5(): ContractorPricingRowInput[] {
  return [HOURLY_ROW, MATERIALS_ROW];
}

test("formSnapshot excludes taxEdited: an edit that only flips taxEdited from true to false is not a change", () => {
  const before = { ...initContractorPricingForm(completeGst5(), GST_5, DEFAULTS), taxEdited: true };
  const after = { ...before, taxEdited: false };
  expect(formSnapshot(before)).toBe(formSnapshot(after));
});

test("formSnapshot changes when any real field changes (labour, materials, charges, tax value, confirmedItems)", () => {
  const base = initContractorPricingForm(completeGst5(), GST_5, DEFAULTS);
  expect(formSnapshot({ ...base, hours: "9" })).not.toBe(formSnapshot(base));
  expect(formSnapshot({ ...base, materialsCost: "999" })).not.toBe(formSnapshot(base));
  expect(formSnapshot(addCharge(base))).not.toBe(formSnapshot(base));
  expect(formSnapshot({ ...base, taxRate: "13" })).not.toBe(formSnapshot(base));

  const withItem = acceptSuggestedItem(initContractorPricingForm([], GST_5, DEFAULTS), {
    description: "Kitchen faucet replacement",
    labourUnitPrice: 325,
    materialUnitPrice: 0,
    taxable: true,
  });
  const withEditedItem = updateConfirmedItem(withItem, withItem.confirmedItems[0].id, "quantity", "2");
  expect(formSnapshot(withEditedItem)).not.toBe(formSnapshot(withItem));
});

test("hasUnsavedPricingChanges: null snapshot (nothing saved yet) is never dirty; a real edit after a snapshot is dirty; the identical state is not", () => {
  const form = initContractorPricingForm(completeGst5(), GST_5, DEFAULTS);
  expect(hasUnsavedPricingChanges(form, null)).toBe(false);

  const snapshot = formSnapshot(form);
  expect(hasUnsavedPricingChanges(form, snapshot)).toBe(false);
  expect(hasUnsavedPricingChanges({ ...form, hours: "9" }, snapshot)).toBe(true);
  // A taxEdited-only flip (what save() does right after a successful save)
  // must never itself read as dirty.
  expect(hasUnsavedPricingChanges({ ...form, taxEdited: true }, formSnapshot(form))).toBe(false);
});

// Failure B (production phone smoke on 607fc25): a reopened, already-saved
// estimate kept Send visible after an unsaved price edit, because the editor
// started with a null dirty baseline and hasUnsavedPricingChanges(form, null)
// is always false. The baseline is now the loaded rows themselves.

/** A saved-item pair exactly as toCanonicalRows() persists it. */
function reopenedSavedItemRows(): ContractorPricingRowInput[] {
  return [
    row({ item_type: "labour", unit: "ea", quantity: 1, unit_price: 110, markup_percent: null, description: "Kitchen faucet replacement", display_order: 0 }),
    row({ item_type: "material", unit: "ea", quantity: 1, unit_price: 0, markup_percent: 0, description: "Kitchen faucet replacement", display_order: 1 }),
  ];
}

test("reopen baseline: a reopened saved-item estimate loads clean, with its own snapshot as the dirty baseline, and is complete", () => {
  const rows = reopenedSavedItemRows();
  const { form, savedSnapshot } = initContractorPricingEditorState(rows, GST_5, DEFAULTS);

  expect(form.pricingAttentionNeeded).toBe(false);
  expect(form.confirmedItems).toHaveLength(1);
  expect(form.confirmedItems[0]).toMatchObject({ quantity: "1", labourUnitPrice: "110", materialUnitPrice: "0", taxable: true });
  expect(savedSnapshot).toBe(formSnapshot(form));
  expect(hasUnsavedPricingChanges(form, savedSnapshot)).toBe(false);

  // The same pricing the detail page seeds EstimateActions with: complete, so
  // Send may show on first load.
  const persisted = withReconstructionGate(
    calculateContractorPricing(rows, { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null }),
    rows
  );
  expect(persisted.complete).toBe(true);
});

test("reopen baseline survives numeric values arriving as strings: baseline and form come from the same object, so the loaded state is still clean", () => {
  // Defensive: PostgREST may hand numeric columns back as strings. Whatever
  // the types, the baseline is the snapshot of this same loaded form.
  const asStrings = reopenedSavedItemRows().map(
    (r) =>
      ({
        ...r,
        quantity: String(r.quantity),
        unit_price: r.unit_price === 110 ? "110.00" : "0",
        markup_percent: r.markup_percent === null ? null : "0",
      }) as unknown as ContractorPricingRowInput
  );
  const { form, savedSnapshot } = initContractorPricingEditorState(asStrings, GST_5, DEFAULTS);
  expect(form.pricingAttentionNeeded).toBe(false);
  expect(hasUnsavedPricingChanges(form, savedSnapshot)).toBe(false);
  const edited = updateConfirmedItem(form, form.confirmedItems[0].id, "labourUnitPrice", "120");
  expect(hasUnsavedPricingChanges(edited, savedSnapshot)).toBe(true);
});

test("reopen baseline: every substantive edit from the loaded state is dirty before any save; only a taxEdited flip is not", () => {
  // Saved-item mode: edit, remove, accept another item.
  const items = initContractorPricingEditorState(reopenedSavedItemRows(), GST_5, DEFAULTS);
  const itemId = items.form.confirmedItems[0].id;
  const dirtyFromItems = (state: typeof items.form) => hasUnsavedPricingChanges(state, items.savedSnapshot);
  expect(dirtyFromItems(updateConfirmedItem(items.form, itemId, "labourUnitPrice", "120"))).toBe(true);
  expect(dirtyFromItems(updateConfirmedItem(items.form, itemId, "materialUnitPrice", "5"))).toBe(true);
  expect(dirtyFromItems(updateConfirmedItem(items.form, itemId, "quantity", "2"))).toBe(true);
  expect(dirtyFromItems(updateConfirmedItem(items.form, itemId, "description", "Faucet"))).toBe(true);
  expect(dirtyFromItems(removeConfirmedItem(items.form, itemId))).toBe(true);
  expect(
    dirtyFromItems(
      acceptSuggestedItem(items.form, { description: "Shutoff valve", labourUnitPrice: 40, materialUnitPrice: 15, taxable: true })
    )
  ).toBe(true);

  // Generic mode: labour, materials, markup, charges, tax.
  const generic = initContractorPricingEditorState(completeGst5(), GST_5, DEFAULTS);
  const dirty = (state: typeof generic.form) => hasUnsavedPricingChanges(state, generic.savedSnapshot);
  expect(dirty(generic.form)).toBe(false);
  expect(dirty({ ...generic.form, hours: "9" })).toBe(true);
  expect(dirty({ ...generic.form, hourlyRate: "100" })).toBe(true);
  expect(dirty(chooseLabourMethod(generic.form, "fixed", DEFAULTS))).toBe(true);
  expect(dirty({ ...generic.form, materialsCost: "1200" })).toBe(true);
  expect(dirty({ ...generic.form, markupPercent: "25" })).toBe(true);
  const withCharge = addCharge(generic.form);
  expect(dirty(withCharge)).toBe(true);
  expect(dirty(updateCharge(withCharge, withCharge.charges[0].id, "amount", "150"))).toBe(true);
  expect(dirty(editTax(generic.form, "taxRate", "13"))).toBe(true);
  expect(dirty(editTax(generic.form, "taxLabel", "HST"))).toBe(true);
  expect(dirty({ ...generic.form, taxEdited: true })).toBe(false);

  // Removing a charge that was loaded from the database is dirty too.
  const chargeRows = [...completeGst5(), row({ item_type: "other", description: "Permit", unit_price: 150, display_order: 2 })];
  const withLoadedCharge = initContractorPricingEditorState(chargeRows, GST_5, DEFAULTS);
  expect(
    hasUnsavedPricingChanges(
      removeCharge(withLoadedCharge.form, withLoadedCharge.form.charges[0].id),
      withLoadedCharge.savedSnapshot
    )
  ).toBe(true);
});

test("the editor seeds its dirty baseline from initContractorPricingEditorState, never a null 'nothing saved yet' snapshot", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain("initContractorPricingEditorState(initialRows, initialTax, defaults)");
  expect(editor).toContain("useState<string>(initialEditorState.savedSnapshot)");
  expect(editor).toContain("useState<ContractorPricingFormState>(initialEditorState.form)");
  expect(editor).not.toMatch(/\[lastSavedSnapshot, setLastSavedSnapshot\] = useState<string \| null>\(null\)/);
});

test("the editor's imperative save handle reuses the exact same save() identifier the inline button calls -- never a second save implementation", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  expect(editor).toContain("useImperativeHandle(ref, () => ({ save }));");
  expect(editor).toContain("onClick={save}");
  // Only one function named save is declared in this file.
  expect([...editor.matchAll(/\basync function save\(/g)]).toHaveLength(1);
});

test("sendReady is fully resolved inside the editor through isPricingSendReady -- the callback never hands a parent raw ingredients to combine itself", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");
  expect(editor).toContain("const sendReady = isPricingSendReady({ status, isDirty, persistedComplete: pricing.complete });");
  expect(editor).toContain("onStateChangeRef.current?.({ status, isDirty, sendReady });");
});

test("the editor publishes its resolved sendReady to EstimateActions whenever it changes, in both directions, and save() dispatches nothing itself", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  const effectStart = editor.indexOf("const publishedSendReadyRef = useRef(sendReady);");
  expect(effectStart, "the readiness publisher exists").toBeGreaterThan(-1);
  const effect = editor.slice(effectStart, editor.indexOf("}, [sendReady]);", effectStart));
  expect(effect).toContain("if (publishedSendReadyRef.current === sendReady) return;");
  expect(effect).toContain("new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: sendReady } })");
  // Exactly one dispatch of the event in the editor: this one.
  expect([...editor.matchAll(/new CustomEvent\(PRICING_CHANGE_EVENT/g)]).toHaveLength(1);

  // save() no longer dispatches: a direct dispatch of the server's complete
  // re-enabled Send over edits typed while the save was in flight.
  const saveStart = editor.indexOf("async function save() {");
  const saveBody = editor.slice(saveStart, editor.indexOf("\n  }\n", editor.indexOf("} catch (error) {", saveStart)));
  expect(saveBody).not.toContain("dispatchEvent");
});

test("shouldRevealSaveFeedback: a failed save and an incomplete-but-successful save reveal their feedback; a complete save, idle and saving do not", () => {
  // Failure A (production phone smoke on 607fc25): tapping the sticky Save
  // Pricing with incomplete pricing is not an error -- the route accepts
  // blank labour/materials (parseLabour/parseMaterials take null) and
  // answers 200 with complete: false. The old scroll lived only in save()'s
  // catch, so this, the common case, never scrolled at all.
  expect(shouldRevealSaveFeedback("error", false)).toBe(true);
  expect(shouldRevealSaveFeedback("error", true)).toBe(true);
  expect(shouldRevealSaveFeedback("saved", false)).toBe(true);
  expect(shouldRevealSaveFeedback("saved", true)).toBe(false);
  expect(shouldRevealSaveFeedback("idle", false)).toBe(false);
  expect(shouldRevealSaveFeedback("saving", false)).toBe(false);

  // The incomplete-save case really does produce an empty, route-valid
  // payload (so a 200, not an error): the real parser accepts it.
  const blank = initContractorPricingForm([], GST_5, DEFAULTS);
  const parsed = parseContractorPricingRequest(JSON.parse(JSON.stringify(toPricingRequestPayload(blank))));
  expect(parsed.ok).toBe(true);
  // ...and the guidance it would then show is the missing-items message.
  const saved = calculateContractorPricing([], { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null });
  expect(saved.complete).toBe(false);
  const preview = resolveContractorPricingPreview(blank, {
    isDelivered: false,
    persistedPricing: saved,
    snapshots: { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null },
  });
  expect(resolveContractorPricingGuidance({ isDelivered: false, preview, persistedPricing: saved }).kind).toBe("missing-items");
});

test("the save feedback scroll runs in an effect after React commits the new status, not inside save() before the error text exists", () => {
  // Structural, not behavioural: this harness has no DOM or React renderer
  // (see estimate-actions-send-state-sync.spec.ts), so the commit ordering
  // is pinned from source. The decision itself is tested above.
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  const saveStart = editor.indexOf("async function save() {");
  const saveEnd = editor.indexOf("\n  }\n", editor.indexOf("} catch (error) {", saveStart));
  const saveBody = editor.slice(saveStart, saveEnd);
  expect(saveBody).not.toContain("scrollIntoView");
  expect(saveBody).not.toContain("requestAnimationFrame");

  const effectStart = editor.indexOf("if (!shouldRevealSaveFeedback(status, pricing.complete)) return;");
  expect(effectStart, "the reveal effect exists").toBeGreaterThan(-1);
  const effectBody = editor.slice(effectStart, editor.indexOf("}, [status, pricing]);", effectStart));
  expect(effectBody).toContain("saveFeedbackRef.current?.scrollIntoView(");
  expect(effectBody).toContain('block: "start"');
  expect(editor).toContain("}, [status, pricing]);");
});

test("the inline Save button is suppressed only by hideInlineSaveButton; the guidance and status/error text in the scrolled feedback block are never hidden", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  expect(editor).toContain("{!hideInlineSaveButton && (");
  const feedbackStart = editor.indexOf('<div ref={saveFeedbackRef} className="flex flex-col gap-6 scroll-mt-6">');
  expect(feedbackStart, "the feedback wrapper is always rendered, unconditionally").toBeGreaterThan(-1);
  const buttonBlockStart = editor.indexOf("{!hideInlineSaveButton && (", feedbackStart);
  const buttonBlockEnd = editor.indexOf(")}", buttonBlockStart) + 2;
  const guidanceIndex = editor.indexOf('{guidance.kind !== "none" && (', feedbackStart);
  const statusSpanIndex = editor.indexOf('<span aria-live="polite" className="text-sm">', buttonBlockEnd);
  expect(guidanceIndex, "the guidance is inside the feedback wrapper").toBeGreaterThan(feedbackStart);
  expect(guidanceIndex).toBeLessThan(buttonBlockStart);
  expect(statusSpanIndex, "the status span renders after, and outside, the hideable button block").toBeGreaterThan(buttonBlockEnd);
});

test("app/estimates/[id]/page.tsx never passes hideInlineSaveButton or onStateChange itself: a delivered estimate keeps the plain editor and its inline Save", () => {
  const detailPage = readFileSync("app/estimates/[id]/page.tsx", "utf8");
  expect(detailPage).not.toContain("hideInlineSaveButton");
  expect(detailPage).not.toContain("onStateChange=");
  // The delivered branch renders ContractorPricingEditor directly, with isDelivered.
  const deliveredStart = detailPage.indexOf("{isDelivered(estimate) ? (");
  const draftStart = detailPage.indexOf("<ContractorPricingDraftEditor", deliveredStart);
  expect(deliveredStart).toBeGreaterThan(-1);
  expect(draftStart).toBeGreaterThan(deliveredStart);
  const deliveredBranch = detailPage.slice(deliveredStart, draftStart);
  expect(deliveredBranch).toContain("<ContractorPricingEditor");
  expect(deliveredBranch).toMatch(/\n\s+isDelivered\n/);
});
