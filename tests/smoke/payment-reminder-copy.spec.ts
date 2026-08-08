import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { buildPaymentReminderSms } from "../../lib/payment-reminder-message";

const STAGES = ["pre_due", "overdue_1", "overdue_2", "overdue_ongoing"] as const;

function ctx(overrides: Partial<Parameters<typeof buildPaymentReminderSms>[1]> = {}) {
  return {
    invoiceRef: "a1b2c3d4",
    amount: "585.50",
    businessName: "Clearwater Plumbing",
    dueDateText: "August 12, 2026",
    paymentLink: null,
    ...overrides,
  };
}

test("every stage identifies the business by name, not 'your contractor'", () => {
  for (const stage of STAGES) {
    const message = buildPaymentReminderSms(stage, ctx());
    expect(message.startsWith("Clearwater Plumbing:")).toBe(true);
    expect(message).not.toContain("your contractor");
  }
});

test("every stage keeps the exact STOP wording", () => {
  for (const stage of STAGES) {
    const message = buildPaymentReminderSms(stage, ctx());
    expect(message).toContain("Reply STOP to stop text reminders.");
  }
});

test("the message uses the actual invoice reference and amount, never invented ones", () => {
  const message = buildPaymentReminderSms("overdue_1", ctx({ invoiceRef: "f00d1234", amount: "1200.00" }));
  expect(message).toContain("Invoice #f00d1234");
  expect(message).toContain("$1200.00");
});

test("the due date appears as given, never invented", () => {
  const message = buildPaymentReminderSms("overdue_1", ctx({ dueDateText: "September 1, 2026" }));
  expect(message).toContain("September 1, 2026");
});

test("a blank business name omits the prefix instead of inventing or defaulting to 'your contractor'", () => {
  const message = buildPaymentReminderSms("pre_due", ctx({ businessName: "" }));
  expect(message.startsWith("Invoice #")).toBe(true);
  expect(message).not.toContain("your contractor");
  expect(message).not.toContain(":");
});

test("messages contain no em dash", () => {
  for (const stage of STAGES) {
    expect(buildPaymentReminderSms(stage, ctx())).not.toContain("—");
  }
});

test("a payment link, when present, is included and replaces the generic ask", () => {
  for (const stage of STAGES) {
    const message = buildPaymentReminderSms(stage, ctx({ paymentLink: "https://pay.example.com/abc" }));
    expect(message).toContain("Pay here: https://pay.example.com/abc.");
    expect(message).not.toContain("Please arrange payment at your earliest convenience.");
  }
});

test("with no payment link configured, the generic ask appears instead", () => {
  for (const stage of STAGES) {
    const message = buildPaymentReminderSms(stage, ctx({ paymentLink: null }));
    expect(message).toContain("Please arrange payment at your earliest convenience.");
    expect(message).not.toContain("Pay here:");
  }
});

test("matches the exact preferred structure with a payment link", () => {
  const message = buildPaymentReminderSms("overdue_1", {
    invoiceRef: "a1b2c3d4",
    amount: "585.50",
    businessName: "Clearwater Plumbing",
    dueDateText: "August 12, 2026",
    paymentLink: "https://pay.example.com/abc",
  });
  expect(message).toBe(
    "Clearwater Plumbing: Invoice #a1b2c3d4 for $585.50 was due August 12, 2026. Pay here: https://pay.example.com/abc. Reply STOP to stop text reminders."
  );
});

test("matches the exact fallback structure with no payment link", () => {
  const message = buildPaymentReminderSms("overdue_1", {
    invoiceRef: "a1b2c3d4",
    amount: "585.50",
    businessName: "Clearwater Plumbing",
    dueDateText: "August 12, 2026",
    paymentLink: null,
  });
  expect(message).toBe(
    "Clearwater Plumbing: Invoice #a1b2c3d4 for $585.50 was due August 12, 2026. Please arrange payment at your earliest convenience. Reply STOP to stop text reminders."
  );
});

test("reminder-stage distinctions are preserved in the lead-in", () => {
  expect(buildPaymentReminderSms("pre_due", ctx())).toContain("is due August 12, 2026.");
  expect(buildPaymentReminderSms("overdue_1", ctx())).toContain("was due August 12, 2026.");
  expect(buildPaymentReminderSms("overdue_2", ctx())).toContain("remains outstanding as of August 12, 2026.");
  expect(buildPaymentReminderSms("overdue_ongoing", ctx())).toContain("remains unpaid.");
});

test("the cron route builds its SMS and email from the centralized formatters, not local copies", () => {
  const source = readFileSync("app/api/cron/payment-reminders/route.ts", "utf8");
  expect(source).toContain('from "@/lib/payment-reminder-message"');
  expect(source).toContain("buildPaymentReminderSms(stageName,");
  expect(source).toContain("buildPaymentReminderEmailHtml(stageName,");
  expect(source).toContain("buildPaymentReminderEmailBody(stageName,");
  // The email path is unaffected by this task and is allowed to keep the
  // "your contractor" fallback (businessName); the SMS path must build its
  // message from smsBusinessName, which has no such fallback.
  expect(source).toContain("businessName: smsBusinessName,");
  expect(source).not.toContain("function buildSmsMessage");
  expect(source).not.toContain("function buildEmailBody");
  expect(source).not.toContain("function buildEmailHtml");
});

test("the cron route computes reminder stages via the shared stage-selection function, not a local copy", () => {
  const source = readFileSync("app/api/cron/payment-reminders/route.ts", "utf8");
  expect(source).toContain('from "@/lib/payment-reminder-stage"');
  expect(source).toContain("computeNextReminderStage(");
  expect(source).not.toContain("const STAGES");
  expect(source).not.toContain("const ONGOING_START_DAYS");
});
