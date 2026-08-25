import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildPaymentReminderEmailBody,
  buildPaymentReminderEmailHtml,
  buildPaymentReminderSms,
} from "../../lib/payment-reminder-message";
import {
  formatDollars,
  formatEstimateForDisplay,
  formatEstimateForDisplayWithPricing,
  formatMoney,
  parseCost,
  parseSummary,
  serializeSummary,
} from "../../lib/estimate-summary";
import { buildCustomerPricingView } from "../../lib/estimate-pricing-mode";
import { renderGroupedLineItemsBlock } from "../../lib/estimate-groups";
import { allAmountsInLabel, type Currency } from "../../lib/currency";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

/** A synthetic estimate, priced identically in both currencies. */
function estimateSummary(currency: Currency): string {
  const items = [
    { id: "l", label: "Labour", cost: "", quantity: "8", unit: "hrs", rate: "95.00", quantityBased: true },
    { id: "m", label: "Copper pipe", cost: "240.00" },
  ];
  return serializeSummary("Estimated total: 0", [], items, 20, [], [], "GST", 5, currency);
}

const REMINDER = {
  invoiceRef: "1042",
  amount: "350.00",
  businessName: "Northside Plumbing",
  dueDateText: "September 4, 2026",
  paymentLink: null,
};
const EMAIL_REMINDER = { ...REMINDER, customerName: "Dana" };

// ── Editor / serializer ──────────────────────────────────────────────────────

test("a USD estimate renders US$ everywhere and never CA$ or a bare $", () => {
  const usd = estimateSummary("usd");

  expect(usd).toContain("US$");
  expect(usd).not.toContain("CA$");
  // No bare "$" that is not preceded by CA or US.
  expect(usd).not.toMatch(/(?<![A-Z])\$\d/);
});

test("a CAD estimate is unchanged and renders CA$", () => {
  const cad = estimateSummary("cad");

  expect(cad).toContain("CA$");
  expect(cad).not.toContain("US$");
  expect(cad).not.toMatch(/(?<![A-Z])\$\d/);
});

test("the same figures produce the same numbers in both currencies", () => {
  const strip = (s: string) => s.replace(/(?:CA|US)\$/g, "@");
  expect(strip(estimateSummary("usd"))).toBe(strip(estimateSummary("cad")));
});

test("a USD estimate survives a serialize / parse / re-serialize round trip", () => {
  const usd = estimateSummary("usd");
  const parsed = parseSummary(usd);

  // Amounts still parse: the CA$/US$ prefix is stripped by parseCost.
  const subtotal = parsed.lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  expect(subtotal).toBe(8 * 95 + 240);

  const reserialized = serializeSummary(
    parsed.preamble,
    parsed.scopeItems,
    parsed.lineItems,
    parsed.depositPercent,
    parsed.beforePricingSections,
    parsed.afterPricingSections,
    parsed.taxLabel,
    parsed.taxRate,
    "usd"
  );
  expect(reserialized).toContain("US$");
  expect(reserialized).not.toContain("CA$");
});

test("totals, tax, deposit, and balance all carry the estimate currency", () => {
  const usd = estimateSummary("usd");
  for (const row of ["Subtotal", "Tax (GST 5%)", "**Total**", "Deposit required (20%)", "Balance on completion"]) {
    const line = usd.split("\n").find((l) => l.includes(row));
    expect(line, `${row} row must exist`).toBeTruthy();
    expect(line!, `${row} must be in US$`).toContain("US$");
  }
});

test("the individual formatters honour an explicit currency", () => {
  expect(formatDollars(1000, "usd")).toBe("US$1,000");
  expect(formatDollars(1000, "cad")).toBe("CA$1,000");
  expect(formatMoney(95, "usd")).toBe("US$95.00");
  expect(formatMoney(95, "cad")).toBe("CA$95.00");
});

// ── Payment reminders: SMS, email body, email HTML, preview ─────────────────

test("a USD reminder SMS quotes US$ and a CAD one quotes CA$", () => {
  const usd = buildPaymentReminderSms("overdue_1", { ...REMINDER, currency: "usd" });
  const cad = buildPaymentReminderSms("overdue_1", { ...REMINDER, currency: "cad" });

  expect(usd).toContain("US$350.00");
  expect(usd).not.toContain("CA$");
  expect(cad).toContain("CA$350.00");
  expect(cad).not.toContain("US$");

  for (const body of [usd, cad]) {
    expect(body).not.toMatch(/(?<![A-Z])\$\d/);
    // Unchanged wording either side of the amount.
    expect(body).toContain("Northside Plumbing: Invoice #1042 for");
    expect(body).toContain("Reply STOP to stop text reminders.");
  }
});

test("every reminder stage carries the currency", () => {
  for (const stage of ["pre_due", "overdue_1", "overdue_2", "overdue_ongoing"] as const) {
    const body = buildPaymentReminderSms(stage, { ...REMINDER, currency: "usd" });
    expect(body, stage).toContain("US$350.00");
    expect(body, stage).not.toMatch(/(?<![A-Z])\$\d/);
  }
});

test("the reminder email HTML quotes the estimate currency", () => {
  const usd = buildPaymentReminderEmailHtml("overdue_1", { ...EMAIL_REMINDER, currency: "usd" });
  const cad = buildPaymentReminderEmailHtml("overdue_1", { ...EMAIL_REMINDER, currency: "cad" });

  expect(usd).toContain("<strong>Amount:</strong> US$350.00");
  expect(cad).toContain("<strong>Amount:</strong> CA$350.00");
  expect(usd).not.toContain("CA$");
  expect(cad).not.toContain("US$");
});

test("the reminder email prose carries no amount, so it needs no currency", () => {
  const body = buildPaymentReminderEmailBody("overdue_1", { ...EMAIL_REMINDER, currency: "usd" });
  expect(body).toContain("Hi Dana");
  expect(body).not.toMatch(/\$/);
});

test("a reminder with no currency defaults to CAD, so existing estimates do not move", () => {
  expect(buildPaymentReminderSms("overdue_1", REMINDER)).toContain("CA$350.00");
  expect(buildPaymentReminderEmailHtml("overdue_1", EMAIL_REMINDER)).toContain("CA$350.00");
});

test("a payment link is unaffected by the currency", () => {
  const withLink = buildPaymentReminderSms("overdue_1", {
    ...REMINDER,
    currency: "usd",
    paymentLink: "https://buy.stripe.com/abc",
  });
  expect(withLink).toContain("US$350.00");
  expect(withLink).toContain("Pay here: https://buy.stripe.com/abc.");
});

// ── Wiring assertions ───────────────────────────────────────────────────────

test("the editor takes the estimate snapshot and never the business setting", () => {
  const editor = code("app/components/editable-estimate-body.tsx");

  // Required, not defaulted. See the /new regression tests below.
  expect(editor).toContain("currency: Currency;");
  expect(editor).not.toContain("currency = DEFAULT_CURRENCY");
  expect(editor).not.toContain("estimate_currency");
  // Saving re-serializes with the same snapshot, so a save cannot rewrite it.
  expect(editor).toMatch(/serializeSummary\([\s\S]{0,600}currency,/);
  // No bare-$ formatting left in the editor.
  expect(editor).not.toContain("'$' + n.toLocaleString");
});

test("both editor call sites forward a currency", () => {
  const pricingEditor = code("app/components/estimate-pricing-editor.tsx");
  expect(pricingEditor).toContain("currency={currency}");

  const detail = code("app/estimates/[id]/page.tsx");
  expect(detail).toContain("readEstimateCurrency(supabaseAdmin, id)");
  expect(detail).toContain("currency={estimateCurrency}");
});

test("every reminder send path passes the estimate snapshot", () => {
  const cron = code("app/api/cron/payment-reminders/route.ts");
  expect(cron).toContain("readEstimateCurrencies");
  expect(cron).toContain("estimateCurrencies.get(estimate.id)");

  const manual = code("app/api/estimates/[id]/send-reminder/route.ts");
  expect(manual).toContain("readEstimateCurrency(supabaseAdmin, estimate.id)");

  const preview = code("app/components/profile-form.tsx");
  expect(preview).toContain("currency: estimateCurrency");
});

test("the share page and PDF label the currency outside the pricing table", () => {
  const share = code("app/share/[id]/page.tsx");
  expect(share).toContain("readEstimateCurrency(supabaseAdmin, id)");
  expect(share).toContain("allAmountsInLabel(estimateCurrency)");

  const pdf = code("lib/generate-pdf.ts");
  expect(pdf).toContain("allAmountsInLabel(options.currency)");
  // Not `?? DEFAULT_CURRENCY`: a USD estimate printed "All amounts in CAD"
  // because no caller ever passed one.
  expect(pdf).not.toContain("DEFAULT_CURRENCY");
  // After the table flush, so no currency code can land inside an amount cell.
  expect(pdf.indexOf("flushTable();")).toBeLessThan(pdf.indexOf("allAmountsInLabel(options.currency"));
});

// ── The USD rendering defect ────────────────────────────────────────────────
//
// A USD estimate rendered CA$ on every customer-facing surface. The cause was
// one shape repeated in four places: a formatter that declared
// `currency: Currency = DEFAULT_CURRENCY` and a caller that had the snapshot
// but did not pass it. The tests below fail on the pre-fix code.

/** Every amount in `s`, with its currency prefix. */
function amounts(s: string): string[] {
  return s.match(/(?:CA|US)?\$[\d,]+(?:\.\d{2})?/g) ?? [];
}

function expectOnly(currency: Currency, rendered: string, label: string) {
  const wrong = currency === "usd" ? "CA$" : "US$";
  const right = currency === "usd" ? "US$" : "CA$";
  expect(amounts(rendered).length, `${label}: must render amounts at all`).toBeGreaterThan(0);
  expect(rendered, `${label}: must not contain ${wrong}`).not.toContain(wrong);
  expect(rendered, `${label}: must contain ${right}`).toContain(right);
  // A bare "$1,200" is just as wrong as the other currency's prefix.
  expect(rendered, `${label}: no unprefixed amounts`).not.toMatch(/(?<![A-Z])\$\d/);
}

const PRICED_RECORD = {
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
};

test("formatEstimateForDisplay renders the estimate's own currency, not CAD", () => {
  for (const currency of ["cad", "usd"] as const) {
    expectOnly(
      currency,
      formatEstimateForDisplay(estimateSummary(currency), currency),
      `display formatter (${currency})`
    );
  }
});

test("formatEstimateForDisplayWithPricing renders the estimate's own currency", () => {
  for (const currency of ["cad", "usd"] as const) {
    const parsed = parseSummary(estimateSummary(currency));
    expectOnly(
      currency,
      formatEstimateForDisplayWithPricing(estimateSummary(currency), parsed.lineItems, currency),
      `pricing formatter (${currency})`
    );
  }
});

test("a USD estimate renders US$ in detailed customer pricing", () => {
  for (const currency of ["cad", "usd"] as const) {
    const view = buildCustomerPricingView({
      estimate: { ...PRICED_RECORD, summary: estimateSummary(currency), currency },
      items: [],
      featureEnabled: false,
    });
    expectOnly(currency, view.summary, `detailed pricing view (${currency})`);
  }
});

test("a USD estimate renders US$ in grouped customer pricing", () => {
  for (const currency of ["cad", "usd"] as const) {
    const block = renderGroupedLineItemsBlock(
      [
        { total: 650, groupLabel: "Demolition and disposal" },
        { total: 1450, groupLabel: "Plumbing" },
      ],
      currency
    );
    expectOnly(currency, block, `grouped line items (${currency})`);
  }
});

test("the currency label and the amounts beside it always agree", () => {
  // The exact defect a customer would see: "All amounts in USD" printed under
  // a table of CA$ figures. Composed the way the share page composes it, from
  // the pricing view plus the label, so a caller that drops the snapshot fails
  // here and not only in the formatter's own unit test.
  for (const currency of ["cad", "usd"] as const) {
    const view = buildCustomerPricingView({
      estimate: { ...PRICED_RECORD, summary: estimateSummary(currency), currency },
      items: [],
      featureEnabled: false,
    });
    const page = [view.summary, allAmountsInLabel(currency)].join("\n");

    expect(page).toContain(currency === "usd" ? "All amounts in USD" : "All amounts in CAD");
    expectOnly(currency, page, `labelled page (${currency})`);
  }
});

test("no customer-facing surface can render an estimate without its currency", () => {
  // /new was the fourth call site: it rendered EditableEstimateBody and the
  // streaming preview with no currency at all, so every USD estimate showed
  // CA$ on the screen that creates it.
  const newPage = code("app/new/page.tsx");
  expect(newPage).toContain("X-Estimate-Currency");
  expect(newPage).toContain("currency={estimateCurrency}");
  expect(newPage).toContain("formatEstimateForDisplay(estimate, estimateCurrency)");

  // The generate route snapshots and reports the same value it saved.
  const generate = code("app/api/generate-estimate/route.ts");
  expect(generate).toContain("estimateCurrencyPatch(estimateCurrency)");
  expect(generate).toContain('"X-Estimate-Currency": estimateCurrency');

  // The pricing view carries the snapshot on the record itself.
  const mode = code("lib/estimate-pricing-mode.ts");
  expect(mode).toContain("formatEstimateForDisplay(estimate.summary, estimate.currency)");
  expect(mode).toContain("renderGroupedLineItemsBlock(groupable, estimate.currency)");

  // ...and the only CAD fallback left sits at the database boundary.
  const server = code("lib/estimate-pricing-server.ts");
  expect(server).toContain("currency: estimateCurrencyOf(estimate)");

  // The share page hands its snapshot to the PDF too.
  const share = code("app/share/[id]/page.tsx");
  expect(share).toContain("currency={estimateCurrency}");
});
