import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  firstHourlyRateCandidate,
  parseContractorPricingRequest,
  toCanonicalRows,
  LABOUR_DESCRIPTION,
  MATERIALS_DESCRIPTION,
  type ContractorPricingRequest,
} from "../../lib/contractor-pricing-request";
import { calculateContractorPricing } from "../../lib/contractor-pricing";

/**
 * Phase 1 slice 2: the semantic pricing request and its canonical encoding
 * (specs/contractor-owned-pricing.md sections 4 and 12).
 *
 * Pure coverage. The database half of the slice (the transaction, promotion,
 * delivered re-check and row replacement) is covered by
 * contractor-pricing-route.spec.ts, which needs live services.
 */

function ok(body: unknown): ContractorPricingRequest {
  const parsed = parseContractorPricingRequest(body);
  if (!parsed.ok) throw new Error(`expected a valid request, got: ${parsed.error}`);
  return parsed.value;
}

function errorFor(body: unknown): string {
  const parsed = parseContractorPricingRequest(body);
  if (parsed.ok) throw new Error("expected the request to be rejected");
  return parsed.error;
}

// ── Saving an incomplete draft ───────────────────────────────────────────────

test("labour only saves, and reports materials missing rather than refusing", () => {
  const rows = toCanonicalRows(ok({ labour: { method: "fixed", amount: 500 } }));
  expect(rows).toHaveLength(1);

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 5,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.missing).toEqual(["materials-missing"]);
});

test("materials only saves, and reports labour missing rather than refusing", () => {
  const rows = toCanonicalRows(ok({ materials: { cost: 200, markupPercent: 10 } }));
  expect(rows).toHaveLength(1);
  expect(rows[0].item_type).toBe("material");

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 5,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.missing).toEqual(["labour-missing"]);
});

test("an empty request saves as no rows and reports both inputs missing", () => {
  const rows = toCanonicalRows(ok({}));
  expect(rows).toEqual([]);

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 5,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.complete).toBe(false);
  expect(pricing.missing).toEqual(["labour-missing", "materials-missing"]);
});

test("fixed labour of $0 persists and is complete beside materials and a tax snapshot", () => {
  const rows = toCanonicalRows(
    ok({ labour: { method: "fixed", amount: 0 }, materials: { cost: 0, markupPercent: 0 } })
  );
  expect(rows[0].unit_price).toBe(0);

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 5,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.complete).toBe(true);
});

test("hourly labour with a rate of 0 saves and reports labour-rate-missing", () => {
  // Never rejected: an interrupted contractor must not lose the hours they
  // already typed. Delivery gating in a later slice is what holds it back.
  const request = ok({ labour: { method: "hourly", hours: 6, rate: 0 } });
  const rows = toCanonicalRows(request);
  expect(rows[0].quantity).toBe(6);
  expect(rows[0].unit).toBe("hr");

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 5,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.missing).toContain("labour-rate-missing");
  expect(firstHourlyRateCandidate(request)).toBeNull();
});

// ── Canonical encoding ───────────────────────────────────────────────────────

test("labour and materials rows carry fixed non-blank descriptions", () => {
  const rows = toCanonicalRows(
    ok({ labour: { method: "hourly", hours: 8, rate: 95 }, materials: { cost: 100, markupPercent: 20 } })
  );

  expect(rows[0].description).toBe(LABOUR_DESCRIPTION);
  expect(rows[1].description).toBe(MATERIALS_DESCRIPTION);
  for (const row of rows) {
    expect(row.description.trim()).not.toBe("");
  }
});

test("the canonical encoding matches the spec's table", () => {
  const hourly = toCanonicalRows(ok({ labour: { method: "hourly", hours: 8, rate: 95 } }))[0];
  expect(hourly).toMatchObject({
    item_type: "labour",
    quantity: 8,
    unit: "hr",
    unit_price: 95,
    markup_percent: null,
    line_total: 760,
  });

  const fixed = toCanonicalRows(ok({ labour: { method: "fixed", amount: 760 } }))[0];
  expect(fixed).toMatchObject({ item_type: "labour", quantity: 1, unit: null, unit_price: 760 });

  const material = toCanonicalRows(ok({ materials: { cost: 1150, markupPercent: 20 } }))[0];
  // unit_price is the contractor's pre-markup cost, and line_total is pre-markup
  // too. Neither is the customer-facing figure; the calculator owns that.
  expect(material).toMatchObject({
    item_type: "material",
    quantity: 1,
    unit: null,
    unit_price: 1150,
    markup_percent: 20,
    line_total: 1150,
  });

  const charge = toCanonicalRows(ok({ charges: [{ description: " Permit ", amount: 150 }] }))[0];
  expect(charge).toMatchObject({
    item_type: "other",
    description: "Permit",
    quantity: 1,
    unit: null,
    unit_price: 150,
  });
});

test("multiple charges keep their order and all persist", () => {
  const rows = toCanonicalRows(
    ok({
      labour: { method: "fixed", amount: 100 },
      charges: [
        { description: "Permit", amount: 150 },
        { description: "Disposal", amount: 75.5 },
        { description: "Equipment", amount: 0 },
      ],
    })
  );

  const charges = rows.filter((row) => row.item_type === "other");
  expect(charges.map((row) => row.description)).toEqual(["Permit", "Disposal", "Equipment"]);
  expect(rows.map((row) => row.display_order)).toEqual([0, 1, 2, 3]);
});

// ── Rejections ───────────────────────────────────────────────────────────────

test("a blank charge description is rejected, never defaulted", () => {
  expect(errorFor({ charges: [{ description: "   ", amount: 10 }] })).toContain("description");
  expect(errorFor({ charges: [{ amount: 10 }] })).toContain("description");
});

test("malformed, negative and non-finite numbers are rejected", () => {
  expect(errorFor({ labour: { method: "hourly", hours: -1, rate: 95 } })).toContain("hours");
  expect(errorFor({ labour: { method: "fixed", amount: Number.NaN } })).toContain("amount");
  expect(errorFor({ labour: { method: "fixed", amount: Number.POSITIVE_INFINITY } })).toContain("amount");
  expect(errorFor({ labour: { method: "fixed", amount: "500" } })).toContain("amount");
  expect(errorFor({ materials: { cost: -5, markupPercent: 0 } })).toContain("cost");
  expect(errorFor({ materials: { cost: 5, markupPercent: -1 } })).toContain("markup");
  expect(errorFor({ materials: { cost: 5, markupPercent: 1001 } })).toContain("markup");
  expect(errorFor({ charges: [{ description: "Permit", amount: -1 }] })).toContain("amount");
  expect(errorFor({ tax: { label: "GST", rate: -1 } })).toContain("rate");
  expect(errorFor({ tax: { label: "  ", rate: 5 } })).toContain("label");
});

test("more than one labour or materials entry is rejected", () => {
  expect(errorFor({ labour: [{ method: "fixed", amount: 1 }, { method: "fixed", amount: 2 }] })).toContain("single");
  expect(errorFor({ materials: [{ cost: 1, markupPercent: 0 }] })).toContain("single");
  expect(errorFor({ labour: { method: "both", hours: 1, rate: 1 } })).toContain("method");
});

// ── Tax ──────────────────────────────────────────────────────────────────────

test("omitted tax is null, so the save preserves the existing snapshot", () => {
  expect(ok({ labour: { method: "fixed", amount: 10 } }).tax).toBeNull();
  expect(ok({ tax: null }).tax).toBeNull();
  expect(ok({ tax: { label: " hst ", rate: 13 } }).tax).toEqual({ label: "hst", rate: 13 });
});

// ── Business-default candidate ───────────────────────────────────────────────

test("only an hourly rate above zero is offered as the business default", () => {
  expect(firstHourlyRateCandidate(ok({ labour: { method: "hourly", hours: 4, rate: 125 } }))).toBe(125);
  expect(firstHourlyRateCandidate(ok({ labour: { method: "hourly", hours: 4, rate: 0 } }))).toBeNull();
  expect(firstHourlyRateCandidate(ok({ labour: { method: "fixed", amount: 500 } }))).toBeNull();
  expect(firstHourlyRateCandidate(ok({}))).toBeNull();
});

// ── Route wiring ─────────────────────────────────────────────────────────────

test("the route persists in one call and takes its totals from the calculator", () => {
  const route = readFileSync("app/api/estimates/[id]/pricing/route.ts", "utf8");

  // One persistence call, and it is the transaction.
  expect(route).toContain('"tpe_save_contractor_pricing"');
  expect(route).not.toMatch(/from\("tpe_estimate_items"\)/);
  expect(route).not.toMatch(/\.update\(/);
  expect(route).not.toMatch(/\.insert\(/);

  // Derived pricing has one implementation.
  expect(route).toContain("calculateContractorPricing(pricingRows, snapshots)");
  expect(route).not.toContain("subtotalCents =");

  // Delivery is checked in the route and re-checked in the transaction.
  expect(route).toContain("isDelivered(estimate)");

  const migration = readFileSync(
    "supabase/migrations/20260916000000_add_contractor_pricing_snapshots_and_save_fn.sql",
    "utf8"
  );
  expect(migration).toContain("for update");
  expect(migration).toContain("ESTIMATE_DELIVERED");
  expect(migration).toContain("delete from public.tpe_estimate_items where estimate_id = p_estimate_id");
  // The transaction persists inputs only. Checked by looking for derived-money
  // variables rather than the words, which appear in the comments that say this
  // arithmetic deliberately lives in TypeScript.
  expect(migration).not.toMatch(/v_subtotal|v_total\b|v_tax_cents|v_deposit\b|v_balance/);
});

test("line_total is written but never read as pricing authority", () => {
  const encoder = readFileSync("lib/contractor-pricing-request.ts", "utf8");
  expect(encoder).toContain("line_total");
  expect(encoder.toLowerCase()).toContain("no phase 1 consumer may read it as pricing authority");

  // The calculator names the column in its units comment and nowhere else: it
  // declares no such field and reads no such property.
  const calculator = readFileSync("lib/contractor-pricing.ts", "utf8");
  expect(calculator).not.toMatch(/line_total\s*[?:]/);
  expect(calculator).not.toMatch(/\.line_total/);

  const route = readFileSync("app/api/estimates/[id]/pricing/route.ts", "utf8");
  expect(route).not.toContain("line_total");
});
