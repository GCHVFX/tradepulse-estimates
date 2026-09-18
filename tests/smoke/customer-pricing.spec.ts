import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { classifyEstimate } from "../../lib/estimate-classification";
import { calculateContractorPricing } from "../../lib/contractor-pricing";
import {
  buildCustomerDocument,
  contractorCustomerDocument,
  toCustomerPricing,
  type ContractorEstimateForCustomer,
  type CustomerPricingSourceRow,
} from "../../lib/customer-pricing";
import { buildCustomerPricingView, type EstimatePricingRecord } from "../../lib/estimate-pricing-mode";

/**
 * Phase 1 slice 5A: classification, the customer-safe contractor pricing
 * projection, and the share page and PDF that render it
 * (specs/contractor-owned-pricing.md sections 2, 11, 13 and 14).
 *
 * No browser, no network, no database. The projection is pure, and the page
 * wiring is checked at source level, which is this project's established
 * pattern for server components (Playwright's JSX transform cannot be
 * rendered by react-dom/server inside a spec).
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

// A fully priced estimate, with values chosen so no internal input collides
// with any selling figure: hours 6.5, rate $91, material cost $910, markup 15%.
//
//   labour    6.5 x 91          =   591.50
//   materials 910 x 1.15        = 1,046.50
//   Permit                      =   150.00
//   subtotal                    = 1,788.00
//   GST 5%                      =    89.40
//   total                       = 1,877.40
//   deposit 30% (over $1,000)   =   563.22
//   balance                     = 1,314.18
const PRICED_ROWS: CustomerPricingSourceRow[] = [
  { item_type: "labour", unit: "hr", quantity: 6.5, unit_price: 91, markup_percent: null, description: "Labour" },
  { item_type: "material", unit: null, quantity: 1, unit_price: 910, markup_percent: 15, description: "Materials" },
  { item_type: "other", unit: null, quantity: 1, unit_price: 150, markup_percent: null, description: "Permit" },
];

const ESTIMATE: ContractorEstimateForCustomer = {
  summary: [
    "# Kitchen Range Circuit",
    "",
    "Run a new 240-volt circuit from the main panel to the range.",
    "",
    "## Scope of Work",
    "- Install a double-pole breaker in the main panel",
    "",
    "## Assumptions and Exclusions",
    "- The panel has room for a new breaker",
    "",
    "## Notes",
    "Power to the kitchen is off for part of the day.",
  ].join("\n"),
  tax_label_snapshot: "GST",
  tax_rate_snapshot: 5,
  deposit_percent_snapshot: 30,
  deposit_threshold_snapshot: 1000,
};

function readyDocument(estimate = ESTIMATE, rows = PRICED_ROWS) {
  const result = contractorCustomerDocument(estimate, rows, "cad");
  if (!result.ready) throw new Error(`expected a ready document, missing: ${result.missing.join(", ")}`);
  return result;
}

// ── Classification ───────────────────────────────────────────────────────────

test("classification follows the three ordered rules and fails closed", () => {
  expect(classifyEstimate({ pricing_source: "contractor_pricing", source: "ai_generated", status: "draft" })).toBe(
    "contractor_pricing"
  );
  // Rule 1 wins over rule 2: a promoted website quote is contractor pricing.
  expect(
    classifyEstimate({ pricing_source: "contractor_pricing", source: "website_quote", status: "needs_review" })
  ).toBe("contractor_pricing");
  expect(classifyEstimate({ pricing_source: "markdown", source: "website_quote", status: "needs_review" })).toBe(
    "website_quote_intake"
  );

  // Everything else is legacy, including anything never anticipated.
  expect(classifyEstimate({ pricing_source: "markdown", source: "ai_generated", status: "draft" })).toBe("legacy");
  expect(classifyEstimate({ pricing_source: "markdown", source: "website_quote", status: "draft" })).toBe("legacy");
  expect(classifyEstimate({ pricing_source: "something_new", source: "app", status: "sent" })).toBe("legacy");
  expect(classifyEstimate({ pricing_source: null, source: null, status: null })).toBe("legacy");
});

// 10 ─────────────────────────────────────────────────────────────────────────

test("10: a legacy structured estimate is legacy, and nothing on the detail page lets it edit pricing", () => {
  // Old AI-priced structured estimates have tpe_estimate_items rows. That does
  // not make them contractor pricing.
  expect(classifyEstimate({ pricing_source: "structured", source: "ai_generated", status: "draft" })).toBe("legacy");
  expect(classifyEstimate({ pricing_source: "structured", source: "ai_generated", status: "sent" })).toBe("legacy");

  const page = code("app/estimates/[id]/page.tsx");
  expect(page).toContain("const pricingClass = classifyEstimate(estimate);");
  // The contractor editor is mounted only for contractor pricing...
  expect(page).toContain("{isContractorPricing && contractorPricing ? (");
  expect(page).toContain("isContractorPricing ? loadContractorPricingRows(estimate.id) : Promise.resolve([])");
  // ...and no legacy editor of any kind remains on the page.
  expect(page).not.toContain("EstimatePricingEditor");
  expect(page).not.toContain("EditableEstimateBody");
  expect(page).not.toContain('pricing_source === "structured"');
  // Legacy drafts say why, in the spec's words.
  expect(page).toContain("This estimate was created with the previous pricing system and is read-only.");
  expect(page).toContain("Create a new estimate to change or send it.");
});

// 1 ──────────────────────────────────────────────────────────────────────────

test("1: customer totals come only from the persisted rows and snapshots, through the one calculation", () => {
  const document = readyDocument();
  const calculated = calculateContractorPricing(PRICED_ROWS, {
    taxRatePercent: 5,
    depositPercent: 30,
    depositThresholdDollars: 1000,
  });

  expect(document.totalCents).toBe(calculated.totalCents);
  expect(document.totalCents).toBe(187_740);

  const text = document.document;
  expect(text).toContain("| Labour | $591.50 |");
  expect(text).toContain("| Materials | $1,046.50 |");
  expect(text).toContain("| Permit | $150.00 |");
  expect(text).toContain("| Subtotal | $1,788.00 |");
  expect(text).toContain("| GST 5% | $89.40 |");
  expect(text).toContain("| **Total** | **CA$1,877.40** |");
  expect(text).toContain("| Deposit required | $563.22 |");
  expect(text).toContain("| Balance on completion | $1,314.18 |");
});

test("Phase 2 slice 3B: taxable and non-taxable rows both stay in subtotal, but only taxable rows contribute to tax", () => {
  const mixedRows: CustomerPricingSourceRow[] = [
    { item_type: "labour", unit: "hr", quantity: 6.5, unit_price: 91, markup_percent: null, description: "Labour", taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 910, markup_percent: 15, description: "Materials", taxable: false },
    { item_type: "other", unit: null, quantity: 1, unit_price: 150, markup_percent: null, description: "Permit", taxable: true },
  ];
  const document = readyDocument(ESTIMATE, mixedRows);
  const calculated = calculateContractorPricing(mixedRows, {
    taxRatePercent: 5,
    depositPercent: 30,
    depositThresholdDollars: 1000,
  });

  // Document total matches the one calculation, exactly like the all-taxable case.
  expect(document.totalCents).toBe(calculated.totalCents);

  const text = document.document;
  // Subtotal is unaffected by taxable: both rows are still in it.
  expect(text).toContain("| Subtotal | $1,788.00 |");
  // Tax is 5% of only the taxable rows: 591.50 (labour) + 150 (permit) = 741.50.
  expect(text).toContain("| GST 5% | $37.08 |");
  expect(text).toContain("| **Total** | **CA$1,825.08** |");
  expect(document.totalCents).toBe(182_508);

  // The internal taxable flag itself never reaches the rendered document.
  expect(text.toLowerCase()).not.toContain("taxable");
});

test("the estimate's own snapshots decide tax and deposit, not anything live", () => {
  // Same rows, different snapshots, different document. There is no other
  // input the function could be reading.
  const hst = readyDocument({ ...ESTIMATE, tax_label_snapshot: "HST", tax_rate_snapshot: 13 });
  expect(hst.document).toContain("| HST 13% |");
  expect(hst.totalCents).toBe(202_044);

  const noDeposit = readyDocument({ ...ESTIMATE, deposit_percent_snapshot: null, deposit_threshold_snapshot: null });
  expect(noDeposit.document).not.toContain("Deposit required");
  expect(noDeposit.document).not.toContain("Balance on completion");
  expect(noDeposit.document).toContain("| **Total** | **CA$1,877.40** |");
});

// 2, 3, 4, 5, 6 ──────────────────────────────────────────────────────────────

test("2 to 5: labour hours, hourly rate, material cost and markup never reach the customer document", () => {
  const text = readyDocument().document;

  // Labour hours and rate.
  expect(text).not.toMatch(/\bhrs?\b/i);
  expect(text).not.toContain("@");
  expect(text).not.toContain("/hr");
  // As a standalone quantity. "$1,046.50" legitimately contains the
  // characters 6.5, so match the hours value only when it stands alone.
  expect(text).not.toMatch(/(?<![\d,.])6\.5(?!\d)/);
  expect(text).not.toContain("$91.00");
  // Contractor material cost.
  expect(text).not.toContain("$910.00");
  expect(text).not.toContain("910");
  // Markup.
  expect(text).not.toMatch(/markup/i);
  expect(text).not.toContain("15%");
  expect(text).not.toMatch(/\bcost\b/i);
});

test("6: the customer projection has no field that could carry a row, an hour, a rate, a cost or a markup", () => {
  const result = toCustomerPricing(
    PRICED_ROWS,
    { taxRatePercent: 5, depositPercent: 30, depositThresholdDollars: 1000 },
    "GST"
  );
  if (!result.ready) throw new Error("expected ready");

  const serialized = JSON.stringify(result);
  for (const internal of [
    "item_type",
    "unit",
    "quantity",
    "unit_price",
    "markup_percent",
    "line_total",
    "hours",
    "rate",
    "cost",
    "markup",
    "hourly",
    "fixed",
    "taxable",
  ]) {
    expect(serialized, internal).not.toContain(`"${internal}`);
  }

  // Every number in it is a selling figure. None is an internal input, in
  // dollars or in cents.
  const numbers: number[] = [];
  JSON.parse(serialized, (_key, value) => {
    if (typeof value === "number") numbers.push(value);
    return value;
  });
  for (const internal of [6.5, 650, 91, 9100, 910, 91_000, 15, 1.15]) {
    expect(numbers, String(internal)).not.toContain(internal);
  }
  expect(numbers.sort((a, b) => a - b)).toEqual(
    [59_150, 104_650, 15_000, 178_800, 8_940, 187_740, 56_322, 131_418].sort((a, b) => a - b)
  );
});

test("6: the public share page hands client components the finished document, never the rows", () => {
  const share = code("app/share/[id]/page.tsx");

  // Rows are loaded and consumed on the server in one place...
  expect(share).toContain("const rows = await loadContractorPricingRows(estimate.id);");
  expect(share).toContain("contractorCustomerDocument(estimate, rows, estimateCurrency)");
  // ...and no prop on the page is fed from them or from the raw estimate
  // pricing fields.
  expect(share).not.toMatch(/\brows=\{/);
  expect(share).not.toMatch(/Rows=\{/);
  expect(share).not.toMatch(/markup/i);
  expect(share).not.toMatch(/snapshot=\{/);
  expect(share).toContain("<EstimateMarkdown content={customerDocument} />");
  expect(share).toContain("summary={customerDocument}");

  // The document the client receives is a plain string of prose and selling
  // amounts: its type has no other field.
  const projection = code("lib/customer-pricing.ts");
  expect(projection).toContain("| { ready: true; document: string; totalCents: number }");
});

// 7 ──────────────────────────────────────────────────────────────────────────

test("7: incomplete contractor pricing produces no customer document at all", () => {
  // A freshly generated estimate: snapshots present, no rows.
  const fresh = contractorCustomerDocument(ESTIMATE, [], "cad");
  expect(fresh.ready).toBe(false);
  if (fresh.ready) throw new Error("unreachable");
  expect(fresh.missing.sort()).toEqual(["labour-missing", "materials-missing"]);
  expect(fresh).not.toHaveProperty("document");
  expect(fresh).not.toHaveProperty("totalCents");

  // Labour priced, materials not: still nothing priced leaves the function.
  const partial = contractorCustomerDocument(ESTIMATE, [PRICED_ROWS[0]], "cad");
  expect(partial.ready).toBe(false);

  // Hourly labour at a rate of 0.
  const zeroRate = contractorCustomerDocument(
    ESTIMATE,
    [{ ...PRICED_ROWS[0], unit_price: 0 }, PRICED_ROWS[1]],
    "cad"
  );
  expect(zeroRate.ready).toBe(false);

  // A null tax snapshot is incomplete, not 0%.
  const noTax = contractorCustomerDocument({ ...ESTIMATE, tax_rate_snapshot: null }, PRICED_ROWS, "cad");
  expect(noTax.ready).toBe(false);

  // Fixed labour of $0 is a deliberate answer, and is complete.
  const freeLabour = contractorCustomerDocument(
    ESTIMATE,
    [{ ...PRICED_ROWS[0], unit: null, quantity: 1, unit_price: 0 }, PRICED_ROWS[1]],
    "cad"
  );
  expect(freeLabour.ready).toBe(true);
});

test("7: the share page renders the not-ready state instead of any part of the document", () => {
  const share = code("app/share/[id]/page.tsx");

  expect(share).toContain("customerDocument = result.ready ? result.document : null;");
  expect(share).toContain("This estimate isn&apos;t ready yet.");

  // The not-ready return comes before the document, the photos and the PDF
  // button are ever rendered.
  const notReady = share.indexOf("if (customerDocument === null) {");
  expect(notReady).toBeGreaterThan(-1);
  expect(notReady).toBeLessThan(share.indexOf("<EstimateMarkdown content={customerDocument} />"));
  expect(notReady).toBeLessThan(share.indexOf("<DownloadPdfButton"));
  expect(notReady).toBeLessThan(share.indexOf('alt="Job site photo"'));

  // Unpriced website-quote intake has no customer document either.
  expect(share).toContain('} else if (pricingClass === "website_quote_intake") {');
});

// 8 ──────────────────────────────────────────────────────────────────────────

test("8: share and PDF render one identical document, and the PDF computes nothing", () => {
  const share = code("app/share/[id]/page.tsx");

  // One variable feeds both surfaces. Nothing between them can diverge.
  expect(share.match(/customerDocument\b/g)?.length).toBeGreaterThanOrEqual(4);
  expect(share).toContain("<EstimateMarkdown content={customerDocument} />");
  expect(share).toContain("summary={customerDocument}");
  expect(share).not.toContain("pricing.selected.summary}");

  // The PDF generator renders the markdown it is given. It imports no pricing
  // module and calls no pricing function, so it has nothing to recalculate or
  // reparse with. (Its comments mention lib/estimate-summary.ts; imports and
  // calls are what matter.)
  const pdf = code("lib/generate-pdf.ts");
  const pdfImports = pdf.match(/^import[^;]+;/gm) ?? [];
  expect(pdfImports.length).toBeGreaterThan(0);
  for (const pricingModule of ["estimate-summary", "estimate-pricing", "contractor-pricing", "customer-pricing"]) {
    expect(pdfImports.join("\n"), pricingModule).not.toContain(pricingModule);
  }
  for (const pricingCall of ["parseSummary(", "computeTotals(", "calculateContractorPricing(", "toCustomerPricing("]) {
    expect(pdf, pricingCall).not.toContain(pricingCall);
  }

  // The detail page's send sheet PDF receives the same document the share page
  // builds, from the same function.
  const page = code("app/estimates/[id]/page.tsx");
  expect(page).toContain("contractorCustomerDocument(estimate, contractorRows, estimateCurrency)");
  expect(page).toContain("summary={customerSummary}");
});

test("8: the pricing block sits where the PDF's own section order puts it", () => {
  const document = readyDocument().document;

  // Title stripped (both surfaces show it separately), then summary, scope,
  // assumptions, pricing, notes: the order lib/generate-pdf.ts sorts into.
  expect(document).not.toContain("# Kitchen Range Circuit");
  const order = [
    "Run a new 240-volt circuit",
    "## Scope of Work",
    "## Assumptions and Exclusions",
    "## Pricing Summary",
    "## Notes",
  ].map((marker) => document.indexOf(marker));
  expect(order.every((index) => index > -1)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  // With no Notes section the block goes last.
  const pricing = toCustomerPricing(PRICED_ROWS, { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null }, "GST");
  if (!pricing.ready) throw new Error("expected ready");
  const noNotes = buildCustomerDocument("# T\n\nSummary.\n\n## Scope of Work\n- Work", pricing.pricing, "cad");
  expect(noNotes.trimEnd().endsWith("| **Total** | **CA$1,877.40** |")).toBe(true);
});

test("a pipe in a charge description cannot break the table on either surface", () => {
  const pricing = toCustomerPricing(
    [PRICED_ROWS[0], PRICED_ROWS[1], { ...PRICED_ROWS[2], description: "Disposal | haul away" }],
    { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null },
    "GST"
  );
  if (!pricing.ready) throw new Error("expected ready");
  const document = buildCustomerDocument("", pricing.pricing, "cad");
  expect(document).toContain("| Disposal / haul away | $150.00 |");
});

// 9 ──────────────────────────────────────────────────────────────────────────

test("9: legacy customer rendering is byte-for-byte what it was, collapsed quantity rows included", () => {
  // A delivered legacy estimate with a quantity-based labour row, in the
  // stored format the 2026-09-11 production estimate uses.
  const record: EstimatePricingRecord = {
    id: "legacy-1",
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
    currency: "cad",
    businessTax: null,
    summary: [
      "Summary text.",
      "",
      "## Line Items",
      "| Item | Qty | Unit | Rate | Cost |",
      "|------|-----|------|------|------|",
      "| Electrician labour | 6 | hrs | $125.00 | $750.00 |",
      "| Permit fee |  |  |  | $150.00 |",
      "",
      "## Pricing Summary",
      "| | |",
      "|---|---|",
      "| Subtotal | $900 |",
      "| Tax (GST 5%) | $45 |",
      "| **Total** | **CA$945** |",
      "| No deposit required | |",
      "| Balance on completion | CA$945 |",
    ].join("\n"),
  };

  const view = buildCustomerPricingView({ estimate: record, items: [], featureEnabled: false });
  expect(view.ok).toBe(true);
  expect(view.summary).toBe(
    [
      "Summary text.",
      "",
      "## Scope of Work",
      "",
      "",
      "## Line Items",
      "| Item | Cost |",
      "|------|------|",
      "| Electrician labour (6 hrs @ $125.00/hr) | $750.00 |",
      "| Permit fee | $150.00 |",
      "",
      "## Pricing Summary",
      "| | |",
      "|---|---|",
      "| Subtotal | $900 |",
      "| Tax (GST 5%) | $45 |",
      "| **Total** | **CA$945** |",
      "| No deposit required | |",
      "| Balance on completion | $945 |",
    ].join("\n")
  );
});

test("9: the share page still renders legacy through the frozen legacy view, and only legacy", () => {
  const share = code("app/share/[id]/page.tsx");

  expect(share).toContain(
    "const pricing = await loadCustomerPricingView(estimate, business ? businessTax(business) : null);"
  );
  expect(share).toContain("customerDocument = pricing.selected.summary;");

  // The legacy call lives inside the final else: classification has already
  // sent contractor pricing and intake elsewhere.
  const legacyCall = share.indexOf("loadCustomerPricingView(estimate");
  expect(legacyCall).toBeGreaterThan(share.indexOf('if (pricingClass === "contractor_pricing") {'));
  expect(legacyCall).toBeGreaterThan(share.indexOf('} else if (pricingClass === "website_quote_intake") {'));
});

// 11 ─────────────────────────────────────────────────────────────────────────

test("11: no contractor pricing path touches the frozen legacy parser or formatter", () => {
  const projection = code("lib/customer-pricing.ts");
  for (const legacy of [
    "estimate-summary",
    "estimate-pricing-mode",
    "estimate-pricing-server",
    "parseSummary",
    "formatEstimateForDisplay",
    "computeTotals",
    "applyDeterministicDeposit",
    "loadCustomerPricingView",
    "buildCustomerPricingView",
  ]) {
    expect(projection, legacy).not.toContain(legacy);
  }

  // The classification module is equally free of it.
  const classification = code("lib/estimate-classification.ts");
  expect(classification).not.toContain("import");

  // Both pages call the legacy loader only on the non-contractor path.
  const page = code("app/estimates/[id]/page.tsx");
  expect(page).toContain(
    "isContractorPricing ? Promise.resolve(null) : loadCustomerPricingView(estimate, businessTax(business))"
  );
  expect(page.match(/loadCustomerPricingView\(/g)?.length).toBe(1);

  const share = code("app/share/[id]/page.tsx");
  expect(share.match(/loadCustomerPricingView\(/g)?.length).toBe(1);
});

test("the authoritative contractor total feeds the detail page's downstream consumers", () => {
  const page = code("app/estimates/[id]/page.tsx");

  // Invoice prefill and the zero-total check read estimateTotal. For contractor
  // pricing it is the calculated total; the legacy parse is never consulted.
  expect(page).toContain("contractorDocument.totalCents / 100");
  expect(page).toContain(": legacyPricing?.selected.total ?? 0;");
  expect(page).not.toContain("const estimateTotal = pricing.selected.total;");
  expect(page).toContain("estimateTotal={estimateTotal}");
});
