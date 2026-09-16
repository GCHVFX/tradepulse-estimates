import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildCustomerPricingView, type EstimatePricingRecord } from "../../lib/estimate-pricing-mode";
import { taxAuthorityFor, type EstimateTax } from "../../lib/estimate-tax";

/**
 * A delivered estimate must keep rendering for the customer even when its
 * business row cannot be read. Its tax is its own stored tax row, so the
 * business is only needed for branding, which has always degraded to empty
 * values. An undelivered estimate is the opposite case: Rates is its only tax
 * authority, so it must fail rather than price against a guessed tax.
 *
 * Pure coverage. Driving this in a browser would mean breaking a real
 * estimate's business row in production, which is exactly what must not
 * happen, so the decision is tested where it is made plus a source check that
 * the share page cannot reintroduce a hard failure for delivered estimates.
 */

const GST_5: EstimateTax = { label: "GST", rate: 5 };

const DELIVERED_SUMMARY = [
  "## Line Items",
  "| Item | Cost |",
  "|------|------|",
  "| Panel replacement | $1,000.00 |",
  "",
  "## Pricing Summary",
  "| | |",
  "|---|---|",
  "| Subtotal | $1,000 |",
  "| Tax (GST 5%) | $50 |",
  "| **Total** | **CA$1,050** |",
  "| No deposit required | |",
  "| Balance on completion | CA$1,050 |",
].join("\n");

function record(overrides: Partial<EstimatePricingRecord> = {}): EstimatePricingRecord {
  return {
    id: "estimate-1",
    businessId: "business-1",
    pricingSource: "markdown",
    customerPricingMode: "detailed",
    status: "sent",
    sentAt: "2026-09-11T02:55:38Z",
    copiedAt: null,
    completedAt: null,
    paymentStatus: null,
    invoiceAmount: null,
    reviewRequestedAt: null,
    summary: DELIVERED_SUMMARY,
    currency: "cad",
    businessTax: null,
    ...overrides,
  };
}

test("a delivered estimate renders when the business row is missing or fails to load", () => {
  const view = buildCustomerPricingView({ estimate: record(), items: [], featureEnabled: false });

  expect(view.ok).toBe(true);
  expect(view.summary).toContain("| Tax (GST 5%) | $50 |");
  expect(view.summary).toContain("| **Total** | **CA$1,050** |");
  expect(view.tax).toBe(50);
  expect(view.total).toBe(1050);
});

test("every delivery signal survives a missing business row", () => {
  const delivered: Array<Partial<EstimatePricingRecord>> = [
    { status: "sent", sentAt: "2026-09-11T02:55:38Z" },
    { status: "sent", sentAt: null, copiedAt: "2026-09-15T12:00:00Z" },
    { status: "done", sentAt: null },
  ];
  for (const signal of delivered) {
    const view = buildCustomerPricingView({
      estimate: record(signal),
      items: [],
      featureEnabled: false,
    });
    expect(view.ok, JSON.stringify(signal)).toBe(true);
    expect(view.summary, JSON.stringify(signal)).toContain("| Tax (GST 5%) | $50 |");
  }
});

test("an undelivered estimate fails instead of pricing against a guessed tax", () => {
  expect(() =>
    buildCustomerPricingView({
      estimate: record({ status: "draft", sentAt: null }),
      items: [],
      featureEnabled: false,
    })
  ).toThrow(/without its business Rates tax/);

  expect(taxAuthorityFor({ sent_at: null, copied_at: null, status: "draft" }, GST_5)).toEqual({
    kind: "rates",
    tax: GST_5,
  });
  expect(taxAuthorityFor({ sent_at: "2026-09-11T02:55:38Z", copied_at: null, status: "sent" }, null)).toEqual({
    kind: "stored",
    fallback: null,
  });
});

test("the one delivered case that still cannot render is the one with no tax anywhere", () => {
  // No stored tax row and no business row. Nothing left could name the rate,
  // so this raises rather than inventing one. Every estimate delivered in
  // production carries a stored tax row, so this is unreachable for real data.
  expect(() =>
    buildCustomerPricingView({
      estimate: record({ summary: "## Line Items\n| Item | Cost |\n|---|---|\n| Work | $10.00 |" }),
      items: [],
      featureEnabled: false,
    })
  ).toThrow(/no stored tax row/);
});

test("the share page loads the estimate first and never hard-fails on the business row", () => {
  const share = readFileSync("app/share/[id]/page.tsx", "utf8");

  const estimateLoad = share.indexOf('.from("tpe_estimates")');
  const businessLoad = share.indexOf('.from("tpe_businesses")');
  expect(estimateLoad).toBeGreaterThan(-1);
  expect(businessLoad).toBeGreaterThan(estimateLoad);

  // The business read reports and continues; it does not throw.
  expect(share).toContain("business ? businessTax(business) : null");
  expect(share).toContain('console.error("[share] business row unavailable"');
  expect(share).not.toMatch(/Could not load the business for shared estimate/);
});
