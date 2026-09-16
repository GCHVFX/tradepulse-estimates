import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  addCharge,
  chooseLabourMethod,
  centsToDollars,
  editTax,
  initContractorPricingForm,
  missingLabels,
  removeCharge,
  toPricingRequestPayload,
  updateCharge,
  type BusinessPricingDefaults,
  type ContractorPricingRowInput,
} from "../../lib/contractor-pricing-form";
import { parseContractorPricingRequest } from "../../lib/contractor-pricing-request";

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

  // The contractor is never sent elsewhere to change it.
  expect(editor).not.toContain("/rates");
  expect(editor).not.toContain("price-book");
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
  expect(Object.keys(payload)).toEqual(["labour", "materials", "charges", "tax"]);

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
  expect(page).toContain('estimate.pricing_source === "contractor_pricing"');
  // The legacy path is still there, unchanged, for everything else.
  expect(page).toContain("EstimatePricingEditor");
});

test("22 and 25: the editor displays backend totals and never parses markdown", () => {
  const editor = readFileSync("app/components/contractor-pricing-editor.tsx", "utf8");

  // Figures come from the response, not from arithmetic in the component.
  expect(editor).toContain("pricing.subtotalCents");
  expect(editor).toContain("pricing.totalCents");
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
  // The error path must not also mark it saved. Anchored on the catch clause
  // itself: the first "catch" in the file is the .catch() guarding the JSON
  // parse, which sits above the success path.
  const catchIndex = editor.indexOf("} catch (error) {");
  expect(catchIndex, "the save has a catch clause").toBeGreaterThan(-1);
  expect(editor.slice(catchIndex)).not.toContain('setStatus("saved")');
});
