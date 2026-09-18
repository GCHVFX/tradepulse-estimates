import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  firstHourlyRateCandidate,
  parseContractorPricingRequest,
  toCanonicalRows,
  LABOUR_DESCRIPTION,
  MATERIALS_DESCRIPTION,
  LINE_ITEM_UNIT,
  type ContractorPricingRequest,
  type ConfirmedLineItemInput,
} from "../../lib/contractor-pricing-request";
import { calculateContractorPricing } from "../../lib/contractor-pricing";

/**
 * Phase 1 slice 2: the semantic pricing request and its canonical encoding
 * (specs/contractor-owned-pricing.md sections 4 and 12).
 *
 * Pure coverage. The database half of the slice (the transaction, promotion,
 * delivered re-check and row replacement) is covered by
 * contractor-pricing-route.spec.ts, which needs real PostgreSQL.
 */

/** A well-formed request: all three inputs present, empty by default. */
function complete(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return { labour: null, materials: null, charges: [], ...partial };
}

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

// ── A PUT is a whole state, so the three inputs are required keys ────────────

test("an omitted labour, materials or charges key is rejected, never a silent clear", () => {
  expect(errorFor({ materials: null, charges: [] })).toContain("labour is required");
  expect(errorFor({ labour: null, charges: [] })).toContain("materials is required");
  expect(errorFor({ labour: null, materials: null })).toContain("charges is required");
});

test("explicit emptiness is accepted: null labour, null materials, no charges", () => {
  const request = ok({ labour: null, materials: null, charges: [] });
  expect(request.labour).toBeNull();
  expect(request.materials).toBeNull();
  expect(request.charges).toEqual([]);
  expect(toCanonicalRows(request)).toEqual([]);

  // null is not a shorthand for an empty charge list.
  expect(errorFor({ labour: null, materials: null, charges: null })).toContain("charges must be a list");
});

test("omitted tax is accepted and means the estimate's snapshot is unchanged", () => {
  expect(ok(complete()).tax).toBeNull();
  expect(ok(complete({ tax: null })).tax).toBeNull();
  expect(ok(complete({ tax: { label: " hst ", rate: 13 } })).tax).toEqual({ label: "hst", rate: 13 });
});

// ── Saving an incomplete draft ───────────────────────────────────────────────

test("labour only saves, and reports materials missing rather than refusing", () => {
  const rows = toCanonicalRows(ok(complete({ labour: { method: "fixed", amount: 500 } })));
  expect(rows).toHaveLength(1);

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 5,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.missing).toEqual(["materials-missing"]);
});

test("materials only saves, and reports labour missing rather than refusing", () => {
  const rows = toCanonicalRows(ok(complete({ materials: { cost: 200, markupPercent: 10 } })));
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
  const rows = toCanonicalRows(ok(complete()));
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
    ok(complete({ labour: { method: "fixed", amount: 0 }, materials: { cost: 0, markupPercent: 0 } }))
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
  const request = ok(complete({ labour: { method: "hourly", hours: 6, rate: 0 } }));
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
    ok(
      complete({
        labour: { method: "hourly", hours: 8, rate: 95 },
        materials: { cost: 100, markupPercent: 20 },
      })
    )
  );

  expect(rows[0].description).toBe(LABOUR_DESCRIPTION);
  expect(rows[1].description).toBe(MATERIALS_DESCRIPTION);
  for (const row of rows) {
    expect(row.description.trim()).not.toBe("");
  }
});

test("the canonical encoding matches the spec's table", () => {
  const hourly = toCanonicalRows(ok(complete({ labour: { method: "hourly", hours: 8, rate: 95 } })))[0];
  expect(hourly).toMatchObject({
    item_type: "labour",
    quantity: 8,
    unit: "hr",
    unit_price: 95,
    markup_percent: null,
    line_total: 760,
  });

  const fixed = toCanonicalRows(ok(complete({ labour: { method: "fixed", amount: 760 } })))[0];
  expect(fixed).toMatchObject({ item_type: "labour", quantity: 1, unit: null, unit_price: 760 });

  const material = toCanonicalRows(ok(complete({ materials: { cost: 1150, markupPercent: 20 } })))[0];
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

  const charge = toCanonicalRows(ok(complete({ charges: [{ description: " Permit ", amount: 150 }] })))[0];
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
    ok(
      complete({
        labour: { method: "fixed", amount: 100 },
        charges: [
          { description: "Permit", amount: 150 },
          { description: "Disposal", amount: 75.5 },
          { description: "Equipment", amount: 0 },
        ],
      })
    )
  );

  const charges = rows.filter((row) => row.item_type === "other");
  expect(charges.map((row) => row.description)).toEqual(["Permit", "Disposal", "Equipment"]);
  expect(rows.map((row) => row.display_order)).toEqual([0, 1, 2, 3]);
});

// ── Rejections ───────────────────────────────────────────────────────────────

test("a blank charge description is rejected, never defaulted", () => {
  expect(errorFor(complete({ charges: [{ description: "   ", amount: 10 }] }))).toContain("description");
  expect(errorFor(complete({ charges: [{ amount: 10 }] }))).toContain("description");
});

test("malformed, negative and non-finite numbers are rejected", () => {
  expect(errorFor(complete({ labour: { method: "hourly", hours: -1, rate: 95 } }))).toContain("hours");
  expect(errorFor(complete({ labour: { method: "fixed", amount: Number.NaN } }))).toContain("amount");
  expect(errorFor(complete({ labour: { method: "fixed", amount: Number.POSITIVE_INFINITY } }))).toContain("amount");
  expect(errorFor(complete({ labour: { method: "fixed", amount: "500" } }))).toContain("amount");
  expect(errorFor(complete({ materials: { cost: -5, markupPercent: 0 } }))).toContain("cost");
  expect(errorFor(complete({ materials: { cost: 5, markupPercent: -1 } }))).toContain("markup");
  expect(errorFor(complete({ materials: { cost: 5, markupPercent: 1001 } }))).toContain("markup");
  expect(errorFor(complete({ charges: [{ description: "Permit", amount: -1 }] }))).toContain("amount");
  expect(errorFor(complete({ tax: { label: "GST", rate: -1 } }))).toContain("rate");
  expect(errorFor(complete({ tax: { label: "  ", rate: 5 } }))).toContain("label");
});

test("more than one labour or materials entry is rejected", () => {
  expect(
    errorFor(complete({ labour: [{ method: "fixed", amount: 1 }, { method: "fixed", amount: 2 }] }))
  ).toContain("single");
  expect(errorFor(complete({ materials: [{ cost: 1, markupPercent: 0 }] }))).toContain("single");
  expect(errorFor(complete({ labour: { method: "both", hours: 1, rate: 1 } }))).toContain("method");
});

// ── Confirmed line items (Phase 2 slice 3A) ──────────────────────────────────

const FAUCET_ITEMS: ConfirmedLineItemInput[] = [
  { description: "Kitchen faucet replacement", quantity: 1, labourUnitPrice: 325, materialUnitPrice: 0, taxable: true },
  { description: "Quarter-turn shutoff valve replacement", quantity: 2, labourUnitPrice: 145, materialUnitPrice: 18, taxable: true },
  { description: "Braided supply line replacement", quantity: 2, labourUnitPrice: 55, materialUnitPrice: 15, taxable: true },
];

test("1: an omitted lineItems key still parses, normalized to an empty array", () => {
  const request = ok(complete());
  expect(request.lineItems).toEqual([]);
});

test("2: an explicitly empty lineItems array behaves identically to omitting it", () => {
  const request = ok(complete({ lineItems: [] }));
  expect(request.lineItems).toEqual([]);
  expect(toCanonicalRows(request)).toEqual(toCanonicalRows(ok(complete())));
});

test("3: one confirmed item produces exactly one labour row and one material row", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] }))
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].item_type).toBe("labour");
  expect(rows[1].item_type).toBe("material");
});

test("4: confirmed quantity is copied to both rows", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 3, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] }))
  );
  expect(rows[0].quantity).toBe(3);
  expect(rows[1].quantity).toBe(3);
});

test("5: the labour row uses unit 'ea' and markup_percent null", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] }))
  );
  expect(rows[0]).toMatchObject({ unit: LINE_ITEM_UNIT, markup_percent: null });
  expect(LINE_ITEM_UNIT).toBe("ea");
});

test("6: the material row uses unit 'ea' and markup_percent explicit 0", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] }))
  );
  expect(rows[1].unit).toBe(LINE_ITEM_UNIT);
  expect(rows[1].markup_percent).toBe(0);
  expect(rows[1].markup_percent).not.toBeNull();
});

test("7: a zero labour price is preserved", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Free labour", quantity: 1, labourUnitPrice: 0, materialUnitPrice: 25, taxable: true }] }))
  );
  expect(rows[0].unit_price).toBe(0);
});

test("8: a zero material price is preserved and the material row is not omitted", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Kitchen faucet replacement", quantity: 1, labourUnitPrice: 325, materialUnitPrice: 0, taxable: true }] }))
  );
  expect(rows).toHaveLength(2);
  expect(rows[1].item_type).toBe("material");
  expect(rows[1].unit_price).toBe(0);
});

test("9: multiple confirmed items preserve pairwise adjacent display order", () => {
  const rows = toCanonicalRows(ok(complete({ lineItems: FAUCET_ITEMS })));
  expect(rows.map((row) => row.display_order)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(rows.map((row) => [row.description, row.item_type])).toEqual([
    ["Kitchen faucet replacement", "labour"],
    ["Kitchen faucet replacement", "material"],
    ["Quarter-turn shutoff valve replacement", "labour"],
    ["Quarter-turn shutoff valve replacement", "material"],
    ["Braided supply line replacement", "labour"],
    ["Braided supply line replacement", "material"],
  ]);
});

test("10: the faucet fixture produces six rows and calculates the expected totals", () => {
  const rows = toCanonicalRows(ok(complete({ lineItems: FAUCET_ITEMS })));
  expect(rows).toHaveLength(6);
  expect(rows.every((row) => row.item_type !== "material" || row.markup_percent === 0)).toBe(true);

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 0,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  // Labour: 325 + (2 x 145) + (2 x 55) = 725
  expect(pricing.labourCents).toBe(72_500);
  // Materials: 0 + (2 x 18) + (2 x 15) = 66
  expect(pricing.materialsCents).toBe(6_600);
  expect(pricing.subtotalCents).toBe(79_100);
});

test("11: confirmed line items combined with generic labour is rejected", () => {
  expect(
    errorFor(
      complete({ labour: { method: "fixed", amount: 100 }, lineItems: FAUCET_ITEMS })
    )
  ).toContain("generic labour");
});

test("12: confirmed line items combined with generic materials is rejected", () => {
  expect(
    errorFor(
      complete({ materials: { cost: 100, markupPercent: 10 }, lineItems: FAUCET_ITEMS })
    )
  ).toContain("generic materials");
});

test("13: confirmed line items combined with charges is accepted", () => {
  const request = ok(complete({ lineItems: FAUCET_ITEMS, charges: [{ description: "Permit", amount: 50 }] }));
  const rows = toCanonicalRows(request);
  expect(rows).toHaveLength(7);
  expect(rows[6]).toMatchObject({ item_type: "other", description: "Permit" });
});

test("14: a blank line item description is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "   ", quantity: 1, labourUnitPrice: 10, materialUnitPrice: 0 }] }))
  ).toContain("description");
});

test("15: a line item quantity of 0 is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "Widget", quantity: 0, labourUnitPrice: 10, materialUnitPrice: 0 }] }))
  ).toContain("quantity");
});

test("16: a negative line item quantity is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "Widget", quantity: -1, labourUnitPrice: 10, materialUnitPrice: 0 }] }))
  ).toContain("quantity");
});

test("17: NaN or Infinity line item quantity is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "Widget", quantity: Number.NaN, labourUnitPrice: 10, materialUnitPrice: 0 }] }))
  ).toContain("quantity");
  expect(
    errorFor(
      complete({ lineItems: [{ description: "Widget", quantity: Number.POSITIVE_INFINITY, labourUnitPrice: 10, materialUnitPrice: 0 }] })
    )
  ).toContain("quantity");
});

test("18: a negative or non-finite labourUnitPrice is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: -5, materialUnitPrice: 0 }] }))
  ).toContain("labourUnitPrice");
  expect(
    errorFor(
      complete({ lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: Number.NaN, materialUnitPrice: 0 }] })
    )
  ).toContain("labourUnitPrice");
});

test("19: a negative or non-finite materialUnitPrice is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: 10, materialUnitPrice: -1 }] }))
  ).toContain("materialUnitPrice");
  expect(
    errorFor(
      complete({
        lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: 10, materialUnitPrice: Number.POSITIVE_INFINITY }],
      })
    )
  ).toContain("materialUnitPrice");
});

test("20: generic Phase 1 encoding is unchanged when lineItems is empty or omitted", () => {
  const withoutKey = toCanonicalRows(
    ok(complete({ labour: { method: "hourly", hours: 8, rate: 95 }, materials: { cost: 100, markupPercent: 20 } }))
  );
  const withEmptyArray = toCanonicalRows(
    ok(
      complete({
        labour: { method: "hourly", hours: 8, rate: 95 },
        materials: { cost: 100, markupPercent: 20 },
        lineItems: [],
      })
    )
  );
  expect(withoutKey).toEqual(withEmptyArray);
  expect(withoutKey).toEqual([
    {
      description: LABOUR_DESCRIPTION,
      item_type: "labour",
      quantity: 8,
      unit: "hr",
      unit_price: 95,
      markup_percent: null,
      line_total: 760,
      display_order: 0,
      taxable: true,
    },
    {
      description: MATERIALS_DESCRIPTION,
      item_type: "material",
      quantity: 1,
      unit: null,
      unit_price: 100,
      markup_percent: 20,
      line_total: 100,
      display_order: 1,
      taxable: true,
    },
  ]);
});

// ── Taxable (Phase 2 slice 3B) ────────────────────────────────────────────────

test("21: confirmed item taxable true is accepted", () => {
  const request = ok(
    complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] })
  );
  expect(request.lineItems[0].taxable).toBe(true);
});

test("22: confirmed item taxable false is accepted", () => {
  const request = ok(
    complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: false }] })
  );
  expect(request.lineItems[0].taxable).toBe(false);
});

test("23: a missing taxable flag is rejected", () => {
  expect(
    errorFor(complete({ lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: 10, materialUnitPrice: 0 }] }))
  ).toContain("taxable");
});

test("24: a null taxable flag is rejected", () => {
  expect(
    errorFor(
      complete({ lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: 10, materialUnitPrice: 0, taxable: null }] })
    )
  ).toContain("taxable");
});

test("25: a string 'false' taxable flag is rejected, not coerced", () => {
  expect(
    errorFor(
      complete({ lineItems: [{ description: "Widget", quantity: 1, labourUnitPrice: 10, materialUnitPrice: 0, taxable: "false" }] })
    )
  ).toContain("taxable");
});

test("26: the labour and material canonical rows inherit true together", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] }))
  );
  expect(rows[0].taxable).toBe(true);
  expect(rows[1].taxable).toBe(true);
});

test("27: the labour and material canonical rows inherit false together", () => {
  const rows = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: false }] }))
  );
  expect(rows[0].taxable).toBe(false);
  expect(rows[1].taxable).toBe(false);
});

test("28: a price-book material row still gets markup_percent 0 regardless of taxable", () => {
  const taxableItem = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: true }] }))
  )[1];
  const nonTaxableItem = toCanonicalRows(
    ok(complete({ lineItems: [{ description: "Widget install", quantity: 1, labourUnitPrice: 50, materialUnitPrice: 10, taxable: false }] }))
  )[1];
  expect(taxableItem.markup_percent).toBe(0);
  expect(nonTaxableItem.markup_percent).toBe(0);
});

test("29: generic labour, materials and charge rows explicitly encode taxable true", () => {
  const rows = toCanonicalRows(
    ok(
      complete({
        labour: { method: "hourly", hours: 8, rate: 95 },
        materials: { cost: 100, markupPercent: 20 },
        charges: [{ description: "Permit", amount: 50 }],
      })
    )
  );
  expect(rows.map((row) => row.taxable)).toEqual([true, true, true]);
});

test("30: the faucet fixture, updated with taxable booleans, keeps its $791 pre-tax subtotal", () => {
  const rows = toCanonicalRows(ok(complete({ lineItems: FAUCET_ITEMS })));
  expect(rows.every((row) => row.taxable === true)).toBe(true);

  const pricing = calculateContractorPricing(rows, {
    taxRatePercent: 0,
    depositPercent: null,
    depositThresholdDollars: null,
  });
  expect(pricing.subtotalCents).toBe(79_100);
});

test("confirmed rows are a literal copy: mutating the source object afterward does not change them, and no price-book identity travels", () => {
  const source = { id: "pricebook-row-123", name: "Kitchen faucet replacement", labourUnitPrice: 325, materialUnitPrice: 0 };
  const confirmed: ConfirmedLineItemInput = {
    description: source.name,
    quantity: 1,
    labourUnitPrice: source.labourUnitPrice,
    materialUnitPrice: source.materialUnitPrice,
    taxable: true,
  };
  const rows = toCanonicalRows(ok(complete({ lineItems: [confirmed] })));
  const before = JSON.stringify(rows);

  // A later, unrelated change to whatever the value came from (a saved
  // price-book item, a matcher suggestion) cannot reach back into rows
  // already produced from a contractor-confirmed copy.
  source.labourUnitPrice = 999;
  source.name = "Renamed item";

  expect(JSON.stringify(rows)).toBe(before);
  expect(rows[0].unit_price).toBe(325);
  expect(rows[0].description).toBe("Kitchen faucet replacement");
  for (const row of rows) {
    expect(Object.keys(row)).not.toContain("id");
    expect(Object.keys(row)).not.toContain("pricebookItemId");
    expect(Object.keys(row)).not.toContain("source_pricebook_item_id");
  }
});

// ── Business-default candidate ───────────────────────────────────────────────

test("only an hourly rate above zero is offered as the business default", () => {
  expect(firstHourlyRateCandidate(ok(complete({ labour: { method: "hourly", hours: 4, rate: 125 } })))).toBe(125);
  expect(firstHourlyRateCandidate(ok(complete({ labour: { method: "hourly", hours: 4, rate: 0 } })))).toBeNull();
  expect(firstHourlyRateCandidate(ok(complete({ labour: { method: "fixed", amount: 500 } })))).toBeNull();
  expect(firstHourlyRateCandidate(ok(complete()))).toBeNull();
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
