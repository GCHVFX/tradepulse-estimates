import { expect, test } from "@playwright/test";
import {
  calculateContractorPricing,
  type PricingRow,
  type PricingSnapshots,
} from "../../lib/contractor-pricing";

/**
 * Phase 1 slice 1: the pure pricing calculation
 * (specs/contractor-owned-pricing.md section 8).
 *
 * No browser, no network, no database. Nothing in the application imports this
 * module yet; these tests are the only caller.
 */

const GST_5: PricingSnapshots = {
  taxRatePercent: 5,
  depositPercent: null,
  depositThresholdDollars: null,
};

/** Tax-free, so a test about subtotals is not reading a tax rounding. */
const NO_TAX: PricingSnapshots = { ...GST_5, taxRatePercent: 0 };

function hourlyLabour(hours: number, rate: number): PricingRow {
  return { item_type: "labour", unit: "hr", quantity: hours, unit_price: rate, markup_percent: null };
}
function fixedLabour(amount: number, quantity = 1): PricingRow {
  return { item_type: "labour", unit: null, quantity, unit_price: amount, markup_percent: null };
}
function materials(cost: number, markupPercent: number, quantity = 1): PricingRow {
  return { item_type: "material", unit: null, quantity, unit_price: cost, markup_percent: markupPercent };
}
function charge(amount: number): PricingRow {
  return { item_type: "other", unit: null, quantity: 1, unit_price: amount, markup_percent: null };
}

// ── Labour ───────────────────────────────────────────────────────────────────

test("1: hourly labour is hours times rate", () => {
  const result = calculateContractorPricing([hourlyLabour(8, 95), materials(0, 0)], NO_TAX);
  expect(result.labourCents).toBe(76_000);
  expect(result.subtotalCents).toBe(76_000);
});

test("2: fixed labour at quantity 1 is its own amount", () => {
  const result = calculateContractorPricing([fixedLabour(760), materials(0, 0)], NO_TAX);
  expect(result.labourCents).toBe(76_000);
});

test("3: fixed labour of $0 is complete, not missing", () => {
  const result = calculateContractorPricing([fixedLabour(0), materials(0, 0)], GST_5);
  expect(result.labourCents).toBe(0);
  expect(result.missing).toEqual([]);
  expect(result.complete).toBe(true);
});

test("4: no labour row is incomplete", () => {
  const result = calculateContractorPricing([materials(100, 0)], GST_5);
  expect(result.missing).toContain("labour-missing");
  expect(result.complete).toBe(false);
});

test("5: hourly labour with a rate of 0 is incomplete", () => {
  const result = calculateContractorPricing([hourlyLabour(6, 0), materials(0, 0)], GST_5);
  expect(result.missing).toContain("labour-rate-missing");
  expect(result.complete).toBe(false);
});

// ── Materials ────────────────────────────────────────────────────────────────

test("6: materials apply the estimate's markup", () => {
  const result = calculateContractorPricing([fixedLabour(0), materials(1150, 20)], NO_TAX);
  expect(result.materialsCents).toBe(138_000);
});

test("7: materials at 0% markup are the contractor's cost", () => {
  const result = calculateContractorPricing([fixedLabour(0), materials(1150, 0)], NO_TAX);
  expect(result.materialsCents).toBe(115_000);
  expect(result.missing).toEqual([]);
});

test("8: no materials row is incomplete", () => {
  const result = calculateContractorPricing([fixedLabour(500)], GST_5);
  expect(result.missing).toContain("materials-missing");
  expect(result.complete).toBe(false);
});

// ── Charges ──────────────────────────────────────────────────────────────────

test("9: optional charges sum, and none of them is required", () => {
  const withCharges = calculateContractorPricing(
    [fixedLabour(0), materials(0, 0), charge(150), charge(75.5), charge(0.25)],
    NO_TAX
  );
  expect(withCharges.chargesCents).toBe(22_575);
  expect(withCharges.subtotalCents).toBe(22_575);

  const none = calculateContractorPricing([fixedLabour(0), materials(0, 0)], GST_5);
  expect(none.chargesCents).toBe(0);
  expect(none.missing).toEqual([]);
});

// ── Tax ──────────────────────────────────────────────────────────────────────

test("10: tax uses the snapshot rate, including a rate that is not 5%", () => {
  const rows = [fixedLabour(1000), materials(0, 0)];
  const hst13 = calculateContractorPricing(rows, { ...GST_5, taxRatePercent: 13 });
  expect(hst13.taxCents).toBe(13_000);
  expect(hst13.totalCents).toBe(113_000);

  const gst5 = calculateContractorPricing(rows, GST_5);
  expect(gst5.taxCents).toBe(5_000);
  expect(gst5.totalCents).toBe(105_000);
});

test("11: a null tax snapshot is incomplete and charges no tax", () => {
  const result = calculateContractorPricing(
    [fixedLabour(1000), materials(0, 0)],
    { ...GST_5, taxRatePercent: null }
  );
  expect(result.missing).toContain("tax-snapshot-missing");
  expect(result.complete).toBe(false);
  expect(result.taxCents).toBe(0);
  expect(result.totalCents).toBe(100_000);
});

// ── Deposit ──────────────────────────────────────────────────────────────────

test("12: the deposit threshold is dollars and converts before comparing", () => {
  // $500 total against a $1,000 threshold. Comparing 50,000 cents with the
  // raw 1,000 dollars would wrongly charge a deposit.
  const result = calculateContractorPricing([fixedLabour(500), materials(0, 0)], {
    taxRatePercent: 0,
    depositPercent: 25,
    depositThresholdDollars: 1000,
  });
  expect(result.totalCents).toBe(50_000);
  expect(result.depositCents).toBe(0);
});

test("13: a total exactly equal to the threshold takes no deposit", () => {
  const result = calculateContractorPricing([fixedLabour(1000), materials(0, 0)], {
    taxRatePercent: 0,
    depositPercent: 25,
    depositThresholdDollars: 1000,
  });
  expect(result.totalCents).toBe(100_000);
  expect(result.depositCents).toBe(0);
});

test("14: a total over the threshold takes the deposit percentage", () => {
  const result = calculateContractorPricing([fixedLabour(1000.01), materials(0, 0)], {
    taxRatePercent: 0,
    depositPercent: 25,
    depositThresholdDollars: 1000,
  });
  expect(result.totalCents).toBe(100_001);
  expect(result.depositCents).toBe(25_000);
});

test("15: null or zero deposit settings never take a deposit", () => {
  const rows = [fixedLabour(5000), materials(0, 0)];
  const cases: PricingSnapshots[] = [
    { taxRatePercent: 0, depositPercent: null, depositThresholdDollars: 1000 },
    { taxRatePercent: 0, depositPercent: 25, depositThresholdDollars: null },
    { taxRatePercent: 0, depositPercent: 0, depositThresholdDollars: 1000 },
    { taxRatePercent: 0, depositPercent: 25, depositThresholdDollars: 0 },
  ];
  for (const snapshots of cases) {
    const result = calculateContractorPricing(rows, snapshots);
    expect(result.depositCents, JSON.stringify(snapshots)).toBe(0);
    expect(result.missing, JSON.stringify(snapshots)).toEqual([]);
  }
});

// ── Rounding ─────────────────────────────────────────────────────────────────

test("16: fractional-cent labour rounds at the line", () => {
  // 3 x 33.333 = 99.999
  const result = calculateContractorPricing([hourlyLabour(3, 33.333), materials(0, 0)], NO_TAX);
  expect(result.labourCents).toBe(10_000);
});

test("17: fractional-cent material markup rounds at the line", () => {
  // 10.01 x 1.075 = 10.76075
  const result = calculateContractorPricing([fixedLabour(0), materials(10.01, 7.5)], NO_TAX);
  expect(result.materialsCents).toBe(1_076);
});

test("18: fractional-cent tax rounds once on the subtotal", () => {
  // 1,007 cents at 5% is 50.35 cents.
  const result = calculateContractorPricing([fixedLabour(10.07), materials(0, 0)], GST_5);
  expect(result.subtotalCents).toBe(1_007);
  expect(result.taxCents).toBe(50);
  expect(result.totalCents).toBe(1_057);
});

test("19: balance is the total minus the rounded deposit", () => {
  const result = calculateContractorPricing([fixedLabour(2990), materials(0, 0)], {
    taxRatePercent: 0,
    depositPercent: 25,
    depositThresholdDollars: 500,
  });
  expect(result.totalCents).toBe(299_000);
  expect(result.depositCents).toBe(74_750);
  expect(result.balanceCents).toBe(result.totalCents - result.depositCents);
  expect(result.balanceCents).toBe(224_250);
});

test("20: the calculator does not mutate its inputs", () => {
  const rows: PricingRow[] = [hourlyLabour(2, 100), materials(50, 10), charge(25)];
  const snapshots: PricingSnapshots = {
    taxRatePercent: 5,
    depositPercent: 25,
    depositThresholdDollars: 100,
  };
  const rowsBefore = JSON.stringify(rows);
  const snapshotsBefore = JSON.stringify(snapshots);

  calculateContractorPricing(rows.map(Object.freeze) as PricingRow[], Object.freeze(snapshots));

  expect(JSON.stringify(rows)).toBe(rowsBefore);
  expect(JSON.stringify(snapshots)).toBe(snapshotsBefore);
});

test("21: hourly labour rounds once at the line, not through a rounded dollar value", () => {
  // 2.75 x 97.50 = 268.125. Rounding the line gives 26,813 cents. Rounding to
  // whole dollars first would give 26,800, and truncating would give 26,812.
  const result = calculateContractorPricing([hourlyLabour(2.75, 97.5), materials(0, 0)], NO_TAX);
  expect(result.labourCents).toBe(26_813);
  expect(result.labourCents).not.toBe(26_800);
  expect(result.labourCents).not.toBe(26_812);
});

test("22: subtotal sums the rounded components, not the rounded sum of components", () => {
  // Labour 1.5 x 95.01 = 142.515 -> 14,252 cents (rounded up).
  // Materials 10.005 at 0% -> 1,000.5 -> 1,001 cents (rounded up).
  // Sum of the rounded components: 15,253.
  // Rounding their unrounded sum (152.52) instead gives 15,252, one cent less.
  const result = calculateContractorPricing(
    [hourlyLabour(1.5, 95.01), materials(10.005, 0)],
    NO_TAX
  );
  expect(result.labourCents).toBe(14_252);
  expect(result.materialsCents).toBe(1_001);
  expect(result.subtotalCents).toBe(15_253);
  expect(result.subtotalCents).not.toBe(15_252);
});

// ── Quantity (Phase 2 slice 2) ────────────────────────────────────────────
//
// Phase 2 saved-item rows carry a contractor-confirmed quantity on fixed
// labour and material rows, which Phase 1 never did (its single labour and
// materials inputs always wrote quantity 1). These tests cover the new
// multiplication; the backward-compatibility test right after them pins the
// quantity-1 case to the exact same cents Phase 1 already produced.

test("23: fixed labour quantity is multiplied", () => {
  // 2 x $145 = $290.
  const result = calculateContractorPricing([fixedLabour(145, 2), materials(0, 0)], NO_TAX);
  expect(result.labourCents).toBe(29_000);
});

test("24: material quantity is multiplied at 0% markup -- a Phase 2 saved item's final price", () => {
  // 2 x $18 = $36. tpe_pricebook_items.material_price is already a final
  // customer-facing price, so a Phase 2 material row carries markup_percent
  // 0: no markup is applied on top.
  const result = calculateContractorPricing([fixedLabour(0), materials(18, 0, 2)], NO_TAX);
  expect(result.materialsCents).toBe(3_600);
});

test("25: material quantity and markup compose -- the generic Materials arithmetic", () => {
  // 2 x $100 x 1.20 = $240. The generic Materials control still writes a
  // real markup_percent on a contractor-entered cost; this is the same
  // formula as test 24, just with a non-zero markup.
  const result = calculateContractorPricing([fixedLabour(0), materials(100, 20, 2)], NO_TAX);
  expect(result.materialsCents).toBe(24_000);
});

test("26: fixed labour quantity multiplies before the single line-level rounding", () => {
  // 2 x 33.3335 = 66.667 -> 6,667 cents. Rounding the unit price to the
  // nearest cent first (3,333.35 -> 3,333) and then doubling would give
  // 6,666 -- one cent less. Multiply first, round once, matches the module's
  // stated rounding order for every other row type.
  const result = calculateContractorPricing([fixedLabour(33.3335, 2), materials(0, 0)], NO_TAX);
  expect(result.labourCents).toBe(6_667);
  expect(result.labourCents).not.toBe(6_666);
});

test("27: multiple Phase 2-style labour/material rows sum correctly", () => {
  // The reference faucet-repair fixture: three saved items, each a fixed
  // labour row and a material row at markup_percent 0 (already-final saved
  // prices). display_order and item identity are later-slice concerns; this
  // only proves the calculator sums several quantity-bearing rows correctly.
  const rows = [
    fixedLabour(325, 1), materials(0, 0, 1), // Kitchen faucet replacement
    fixedLabour(145, 2), materials(18, 0, 2), // Quarter-turn shutoff valve replacement
    fixedLabour(55, 2), materials(15, 0, 2), // Braided supply line replacement
  ];
  const result = calculateContractorPricing(rows, NO_TAX);
  // Labour: 325 + (2 x 145) + (2 x 55) = 725
  expect(result.labourCents).toBe(72_500);
  // Materials: 0 + (2 x 18) + (2 x 15) = 66
  expect(result.materialsCents).toBe(6_600);
  expect(result.subtotalCents).toBe(79_100);
});

test("28: backward compatibility -- quantity 1 produces exactly the same cents as before this slice", () => {
  const fixed = calculateContractorPricing([fixedLabour(760, 1), materials(0, 0)], NO_TAX);
  expect(fixed.labourCents).toBe(76_000);

  const material = calculateContractorPricing(
    [fixedLabour(0), materials(1150, 20, 1)],
    NO_TAX
  );
  expect(material.materialsCents).toBe(138_000);
});
