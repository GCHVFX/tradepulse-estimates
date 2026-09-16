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
import { GST_5, RATES_GST_5 } from "../fixtures/tax";

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

// Only the Pricing Summary's Total row identifies the currency explicitly
// (CA$/US$) -- every other amount (line items, unit rates, Subtotal, Tax,
// Deposit, Balance, the preamble's Estimated total) renders a bare $, so the
// code is not repeated throughout the estimate. See lib/currency.ts's module
// comment and formatCurrency's `bare` option.
test("a USD estimate renders US$ exactly once (the Total row) and never CA$", () => {
  const usd = estimateSummary("usd");

  expect(usd.match(/US\$/g)).toHaveLength(1);
  expect(usd).not.toContain("CA$");
  // Every other amount is a bare $.
  expect(usd).toMatch(/(?<![A-Z])\$\d/);
});

test("a CAD estimate renders CA$ exactly once (the Total row) and never US$", () => {
  const cad = estimateSummary("cad");

  expect(cad.match(/CA\$/g)).toHaveLength(1);
  expect(cad).not.toContain("US$");
  expect(cad).toMatch(/(?<![A-Z])\$\d/);
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
    GST_5.label,
    GST_5.rate,
    "usd"
  );
  expect(reserialized).toContain("US$");
  expect(reserialized).not.toContain("CA$");
});

test("only Total carries the explicit currency; Subtotal, Tax, Deposit, and Balance are bare", () => {
  const usd = estimateSummary("usd");
  for (const row of ["Subtotal", "Tax (GST 5%)", "Deposit required (20%)", "Balance on completion"]) {
    const line = usd.split("\n").find((l) => l.includes(row));
    expect(line, `${row} row must exist`).toBeTruthy();
    expect(line!, `${row} must not repeat the currency code`).not.toMatch(/CA\$|US\$/);
    expect(line!, `${row} must still show a bare $ amount`).toMatch(/\$\d/);
  }
  const totalLine = usd.split("\n").find((l) => l.includes("**Total**"));
  expect(totalLine, "Total row must exist").toBeTruthy();
  expect(totalLine!, "Total must be in US$").toContain("US$");
});

test("the individual formatters honour an explicit currency", () => {
  expect(formatDollars(1000, "usd")).toBe("US$1,000");
  expect(formatDollars(1000, "cad")).toBe("CA$1,000");
  expect(formatMoney(95, "usd")).toBe("US$95.00");
  expect(formatMoney(95, "cad")).toBe("CA$95.00");
});

test("`bare: true` renders a plain $ regardless of currency", () => {
  expect(formatDollars(1000, "usd", { bare: true })).toBe("$1,000");
  expect(formatDollars(1000, "cad", { bare: true })).toBe("$1,000");
  expect(formatMoney(95, "usd", { bare: true })).toBe("$95.00");
  expect(formatMoney(95, "cad", { bare: true })).toBe("$95.00");
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
//
// A later, deliberate change made every amount except the final Total row
// render bare ($) rather than repeating CA$/US$ throughout -- see the `bare`
// option on formatCurrency. expectOnly() below still enforces the one
// invariant that actually matters (the *wrong* currency's code never
// appears, and the *right* one appears at least once, at the Total), and no
// longer forbids bare amounts, since those are now intentional.

/** Every amount in `s`, with its currency prefix. */
function amounts(s: string): string[] {
  return s.match(/(?:CA|US)?\$[\d,]+(?:\.\d{2})?/g) ?? [];
}

function expectOnly(currency: Currency, rendered: string, label: string) {
  const wrong = currency === "usd" ? "CA$" : "US$";
  const right = currency === "usd" ? "US$" : "CA$";
  expect(amounts(rendered).length, `${label}: must render amounts at all`).toBeGreaterThan(0);
  expect(rendered, `${label}: must not contain ${wrong}`).not.toContain(wrong);
  expect(rendered, `${label}: must contain ${right} at least once (the Total row)`).toContain(right);
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
  businessTax: GST_5,
};

test("formatEstimateForDisplay renders the estimate's own currency, not CAD", () => {
  for (const currency of ["cad", "usd"] as const) {
    expectOnly(
      currency,
      formatEstimateForDisplay(estimateSummary(currency), currency, RATES_GST_5),
      `display formatter (${currency})`
    );
  }
});

test("formatEstimateForDisplayWithPricing renders the estimate's own currency", () => {
  for (const currency of ["cad", "usd"] as const) {
    const parsed = parseSummary(estimateSummary(currency));
    expectOnly(
      currency,
      formatEstimateForDisplayWithPricing(estimateSummary(currency), parsed.lineItems, currency, RATES_GST_5),
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

test("grouped work-package totals render bare, regardless of currency", () => {
  // This block only ever replaces the Line Items section; the estimate's
  // one coded Total lives in the Pricing Summary block alongside it (see
  // "the currency label and the amounts beside it always agree" below), so
  // in isolation it must contain no currency code at all -- not even the
  // right one.
  for (const currency of ["cad", "usd"] as const) {
    const block = renderGroupedLineItemsBlock(
      [
        { total: 650, groupLabel: "Demolition and disposal" },
        { total: 1450, groupLabel: "Plumbing" },
      ],
      currency
    );
    expect(block, `grouped line items (${currency})`).not.toMatch(/CA\$|US\$/);
    expect(block, `grouped line items (${currency}) still shows amounts`).toMatch(/\$\d/);
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
  // /new was the fourth call site: it rendered the markdown editor and the
  // streaming preview with no currency at all, so every USD estimate showed
  // CA$ on the screen that creates it. Phase 1 slice 4 removed the money from
  // that screen entirely rather than giving it a currency: a generated
  // estimate carries no prices, the contractor enters those on the saved
  // record, and the pricing editor there renders from the estimate's own
  // currency snapshot. So the rule for /new is now the stronger one.
  const newPage = code("app/new/page.tsx");
  expect(newPage).not.toContain("formatEstimateForDisplay");
  expect(newPage).not.toContain("estimateCurrency");
  expect(newPage).not.toContain("formatCurrency");

  // The generate route still snapshots the currency onto the row it writes.
  const generate = code("app/api/generate-estimate/route.ts");
  expect(generate).toContain("currency: estimateCurrency,");
  const record = code("lib/generated-estimate.ts");
  expect(record).toContain("estimateCurrencyPatch(input.currency)");

  // The pricing view carries the snapshot on the record itself.
  const mode = code("lib/estimate-pricing-mode.ts");
  expect(mode).toContain("formatEstimateForDisplay(estimate.summary, estimate.currency, taxAuthority)");
  expect(mode).toContain("renderGroupedLineItemsBlock(groupable, estimate.currency)");

  // ...and the only CAD fallback left sits at the database boundary.
  const server = code("lib/estimate-pricing-server.ts");
  expect(server).toContain("currency: estimateCurrencyOf(estimate)");

  // The share page hands its snapshot to the PDF too.
  const share = code("app/share/[id]/page.tsx");
  expect(share).toContain("currency={estimateCurrency}");
});
