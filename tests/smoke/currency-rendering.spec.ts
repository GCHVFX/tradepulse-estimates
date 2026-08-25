import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildPaymentReminderEmailBody,
  buildPaymentReminderEmailHtml,
  buildPaymentReminderSms,
} from "../../lib/payment-reminder-message";
import {
  formatDollars,
  formatMoney,
  parseCost,
  parseSummary,
  serializeSummary,
} from "../../lib/estimate-summary";
import type { Currency } from "../../lib/currency";

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

  expect(editor).toContain("currency = DEFAULT_CURRENCY");
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
  expect(pdf).toContain("allAmountsInLabel(options.currency ?? DEFAULT_CURRENCY)");
  // After the table flush, so no currency code can land inside an amount cell.
  expect(pdf.indexOf("flushTable();")).toBeLessThan(pdf.indexOf("allAmountsInLabel(options.currency"));
});
