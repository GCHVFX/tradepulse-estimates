import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isDelivered } from "../../lib/estimate-delivery";
import {
  businessTax,
  parseTaxHeaders,
  taxAuthorityFor,
  taxHeaders,
  TAX_LABEL_HEADER,
  TAX_RATE_HEADER,
  type EstimateTax,
} from "../../lib/estimate-tax";
import {
  applyDeterministicDeposit,
  computeTotals,
  parseSummary,
  serializeSummary,
  type LineItem,
} from "../../lib/estimate-summary";
import { buildCustomerPricingView, type EstimatePricingRecord } from "../../lib/estimate-pricing-mode";

// Tax hotfix (spec Appendix A). An undelivered estimate's tax comes from the
// business's Rates settings. The AI-written tax row in the stored summary is
// not an authority, and there is no hard-coded 5% fallback anywhere in the
// tax path. A delivered estimate keeps rendering the tax row it was sent with.

const HST_13: EstimateTax = { label: "HST", rate: 13 };
const DEPOSIT_OVER_1600: { percent: number; thresholdDollars: number } = { percent: 25, thresholdDollars: 1600 };

const LINE_ITEMS: LineItem[] = [
  { id: "labour", label: "Labour", cost: "", quantity: "10", unit: "hrs", rate: "100.00", quantityBased: true },
  { id: "materials", label: "Materials", cost: "500.00" },
];

/**
 * A stored estimate exactly as the pre-hotfix model and serializer left it:
 * a "Tax (GST 5%)" row the model wrote, and a deposit rule of 25% over $1,600.
 * Subtotal $1,500. At GST 5% the total is $1,575 (no deposit); at the
 * business's real HST 13% it is $1,695 (deposit applies).
 */
function aiTaxedSummary(): string {
  return serializeSummary(
    "Replace the panel and tidy the circuits.\n\nEstimated total: $1,575",
    [{ id: "s", text: "Replace the panel." }],
    LINE_ITEMS,
    0,
    [],
    [{ heading: "Payment Terms", content: "This estimate is valid for 30 days from the date above." }],
    "GST",
    5,
    "cad",
    DEPOSIT_OVER_1600
  );
}

function record(overrides: Partial<EstimatePricingRecord> = {}): EstimatePricingRecord {
  return {
    id: "estimate-1",
    businessId: "business-1",
    pricingSource: "markdown",
    customerPricingMode: "detailed",
    status: "draft",
    sentAt: null,
    copiedAt: null,
    completedAt: null,
    paymentStatus: null,
    invoiceAmount: null,
    reviewRequestedAt: null,
    summary: aiTaxedSummary(),
    currency: "cad",
    businessTax: HST_13,
    ...overrides,
  };
}

test("isDelivered: sent_at, copied_at, or a sent/done status each mean delivered", () => {
  const none = { sent_at: null, copied_at: null, status: "draft" };
  expect(isDelivered(none)).toBe(false);
  expect(isDelivered({ ...none, status: "needs_review" })).toBe(false);
  expect(isDelivered({ ...none, sent_at: "2026-09-11T02:55:38Z" })).toBe(true);
  // Copy link sets copied_at and status 'sent' but never sent_at.
  expect(isDelivered({ ...none, copied_at: "2026-09-15T12:00:00Z" })).toBe(true);
  expect(isDelivered({ ...none, status: "sent" })).toBe(true);
  expect(isDelivered({ ...none, status: "done" })).toBe(true);
});

test("tax line uses the business tax rate, never a parsed or hard-coded 5%", () => {
  const view = buildCustomerPricingView({ estimate: record(), items: [], featureEnabled: false });

  expect(view.ok).toBe(true);
  expect(view.tax).toBe(195);
  expect(view.total).toBe(1695);
  expect(view.summary).toContain("| Tax (HST 13%) | $195 |");
  expect(view.summary).toContain("| **Total** | **CA$1,695** |");
  expect(view.summary).toContain("Estimated total: $1,695");
  expect(view.summary).not.toContain("GST 5%");
  // The deposit rule resolves against the Rates-taxed total, which crosses
  // the $1,600 threshold the AI-taxed total did not.
  expect(view.summary).toContain("| Deposit required (25%) | $423.75 |");
});

test("a delivered estimate keeps rendering the tax row it was sent with", () => {
  const variants: Array<Partial<EstimatePricingRecord>> = [
    { status: "sent", sentAt: "2026-09-11T02:55:38Z" },
    { status: "sent", copiedAt: "2026-09-15T12:00:00Z" },
    { status: "done" },
  ];
  for (const delivered of variants) {
    const view = buildCustomerPricingView({ estimate: record(delivered), items: [], featureEnabled: false });
    const name = JSON.stringify(delivered);

    expect(view.ok, name).toBe(true);
    expect(view.summary, name).toContain("| Tax (GST 5%) | $75 |");
    expect(view.summary, name).toContain("| **Total** | **CA$1,575** |");
    expect(view.summary, name).toContain("| No deposit required | |");
    expect(view.summary, name).not.toContain("HST");
  }
});

test("a delivered estimate with no stored tax row falls back to Rates, never to 5%", () => {
  const noTaxRow = ["## Line Items", "| Item | Cost |", "|------|------|", "| Materials | $200.00 |"].join("\n");
  const pst7: EstimateTax = { label: "PST", rate: 7 };
  const view = buildCustomerPricingView({
    estimate: record({ summary: noTaxRow, status: "sent", sentAt: "2026-09-11T02:55:38Z", businessTax: pst7 }),
    items: [],
    featureEnabled: false,
  });

  expect(view.summary).toContain("| Tax (PST 7%) | $14 |");
  expect(view.summary).not.toContain("5%");
});

test("a business rate of 0% renders 0%, not a substituted 5%", () => {
  const view = buildCustomerPricingView({
    estimate: record({ businessTax: { label: "GST", rate: 0 } }),
    items: [],
    featureEnabled: false,
  });

  expect(view.tax).toBe(0);
  expect(view.summary).toContain("| Tax (GST 0%) | $0 |");
  expect(view.summary).toContain("| **Total** | **CA$1,500** |");
});

test("parsing never invents a tax, and totals cannot be computed without a rate", () => {
  const parsed = parseSummary(["## Line Items", "| Item | Cost |", "|------|------|", "| Materials | $200.00 |"].join("\n"));
  expect(parsed.storedTax).toBeNull();
  expect(parseSummary(aiTaxedSummary()).storedTax).toEqual({ label: "GST", rate: 5 });

  // Function.length stops counting at the first defaulted parameter, so a
  // reintroduced `taxRate = 5` default would drop this to 1.
  expect(computeTotals.length).toBe(2);
});

test("generation replaces the model's tax row with Rates and resolves the deposit against that total", () => {
  const normalized = applyDeterministicDeposit(aiTaxedSummary(), "cad", DEPOSIT_OVER_1600, HST_13);

  expect(normalized).toContain("| Tax (HST 13%) | $195 |");
  expect(normalized).toContain("| **Total** | **CA$1,695** |");
  expect(normalized).toContain("| Deposit required (25%) | $423.75 |");
  expect(normalized).toContain("A deposit of $423.75 (25% of the total) is required before work begins.");
  expect(normalized).not.toContain("GST 5%");
});

test("the generation prompt no longer asks the model for tax", () => {
  const route = readFileSync("app/api/generate-estimate/route.ts", "utf8");

  expect(route).not.toContain("Calculate tax as");
  expect(route).not.toContain("TAX_LABEL");
  expect(route).not.toContain("TAX_RATE");
  expect(route).toContain("const tax = businessTax(business);");

  // Phase 1 slice 4: the prompt asks for no pricing of any kind, so the
  // Pricing Summary section and the deterministic deposit step that had to
  // correct it are both gone. Rates is still the only tax authority, and it
  // now reaches the estimate as a snapshot on the row rather than as a
  // response header for the editor on /new to price against.
  expect(route).not.toContain("Pricing Summary");
  expect(route).not.toContain("applyDeterministicDeposit");
  expect(route).toContain("newGeneratedEstimateInsert({");

  const record = readFileSync("lib/generated-estimate.ts", "utf8");
  expect(record).toContain("tax_label_snapshot: input.tax.label,");
  expect(record).toContain("tax_rate_snapshot: input.tax.rate,");
});

test("no hidden 5% or GST default remains in the tax path", () => {
  const summary = readFileSync("lib/estimate-summary.ts", "utf8");
  const editor = readFileSync("app/components/editable-estimate-body.tsx", "utf8");
  const route = readFileSync("app/api/generate-estimate/route.ts", "utf8");

  expect(summary).not.toMatch(/taxRate\s*=\s*5/);
  expect(summary).not.toMatch(/taxLabel\s*=\s*'GST'/);
  expect(editor).not.toContain("|| 'GST'");
  expect(editor).not.toContain("setTaxRate");
  expect(route).not.toContain("tax_rate ?? 5");
  expect(route).not.toContain("tax_label ?? 'GST'");
});

test("tax headers round-trip, and a missing header is never replaced by a default", () => {
  const headers = taxHeaders({ label: "GST + PST", rate: 12 });
  expect(parseTaxHeaders(headers[TAX_LABEL_HEADER], headers[TAX_RATE_HEADER])).toEqual({ label: "GST + PST", rate: 12 });
  expect(parseTaxHeaders(null, "5")).toBeNull();
  expect(parseTaxHeaders("GST", null)).toBeNull();
  expect(parseTaxHeaders("GST", "")).toBeNull();
  expect(parseTaxHeaders("GST", "five")).toBeNull();
});

test("businessTax reads the Rates row and refuses a non-numeric rate", () => {
  expect(businessTax({ tax_label: "hst", tax_rate: 13 })).toEqual({ label: "HST", rate: 13 });
  expect(() => businessTax({ tax_label: "GST", tax_rate: Number.NaN })).toThrow();
  expect(taxAuthorityFor({ sent_at: null, copied_at: null, status: "draft" }, HST_13)).toEqual({ kind: "rates", tax: HST_13 });
  expect(taxAuthorityFor({ sent_at: null, copied_at: null, status: "done" }, HST_13)).toEqual({ kind: "stored", fallback: HST_13 });
});

// Source-level, not rendered: Playwright's own JSX transform wraps elements in
// its component-testing objects, which react-dom/server refuses to render, so
// the editor component cannot be rendered inside a spec in this project. The
// value shown is the resolveEstimateTax() output covered by the tests above;
// what this adds is that it is plain text pointing at Rates, with no input of
// any kind left to type a per-estimate tax into.
test("the editor shows the authoritative tax as text, with a link to Rates", () => {
  const editor = readFileSync("app/components/editable-estimate-body.tsx", "utf8");

  expect(editor).toContain(
    "const { label: taxLabel, rate: taxRate } = resolveEstimateTax(parsed.storedTax, taxAuthority);"
  );
  expect(editor).toContain("<span>Tax ({taxLabel} {String(parseFloat(taxRate.toFixed(2)))}%)</span>");
  expect(editor).toMatch(/<Link href="\/rates"[\s\S]*?>\s*Set in Rates\s*<\/Link>/);

  // No tax input survives: not editable, not read-only, none at all.
  expect(editor).not.toMatch(/aria-label="Tax (label|rate)"/);
  expect(editor).not.toContain("setTaxLabel");
});
