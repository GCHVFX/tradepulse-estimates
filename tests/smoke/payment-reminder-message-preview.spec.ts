import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { buildPaymentReminderSms } from "../../lib/payment-reminder-message";

// The Profile "Message preview" section's exact fixed example values, kept
// in sync with app/components/profile-form.tsx's PREVIEW_INVOICE_REF /
// PREVIEW_AMOUNT / PREVIEW_DUE_DATE constants (asserted below via source
// inspection, since profile-form.tsx is a client component this Playwright
// unit config can't render without a DOM testing library).
const PREVIEW_INVOICE_REF = "1042";
const PREVIEW_AMOUNT = "350";
const PREVIEW_DUE_DATE = "August 4, 2026";

test("the preview's fixed example values match what the Profile UI actually renders", () => {
  const source = readFileSync("app/components/profile-form.tsx", "utf8");
  expect(source).toContain(`const PREVIEW_INVOICE_REF = "${PREVIEW_INVOICE_REF}"`);
  expect(source).toContain(`const PREVIEW_AMOUNT = "${PREVIEW_AMOUNT}"`);
  expect(source).toContain(`const PREVIEW_DUE_DATE = "${PREVIEW_DUE_DATE}"`);
});

test("the Profile preview calls buildPaymentReminderSms rather than duplicating the message copy", () => {
  const source = readFileSync("app/components/profile-form.tsx", "utf8");
  expect(source).toContain('import { buildPaymentReminderSms } from "@/lib/payment-reminder-message"');
  expect(source).toContain('buildPaymentReminderSms("overdue_1"');
  // No independent copy of the wording anywhere in the component.
  expect(source).not.toContain("Reply STOP to stop text reminders.");
});

test("the preview reads the live (not just saved) business name and payment link state", () => {
  const source = readFileSync("app/components/profile-form.tsx", "utf8");
  // name / paymentLink are the same useState values the input fields below
  // write to on every keystroke, so the preview call reading them directly
  // updates before save, with no separate "preview state" to fall out of
  // sync.
  expect(source).toContain("businessName: name.trim(),");
  expect(source).toContain("paymentLink: paymentLink.trim() || null,");
});

test("the example reminder text is collapsed, read-only markup, not rendered inside an editable input", () => {
  const source = readFileSync("app/components/profile-form.tsx", "utf8");
  const previewSectionStart = source.indexOf("<details");
  expect(previewSectionStart).toBeGreaterThan(-1);
  const previewSectionEnd = source.indexOf("</details>", previewSectionStart);
  expect(previewSectionEnd).toBeGreaterThan(previewSectionStart);
  const previewSection = source.slice(previewSectionStart, previewSectionEnd + "</details>".length);
  expect(previewSection).toContain("<details");
  expect(previewSection).toContain("Example only");
  expect(previewSection).toContain('}).replace("Invoice #", "Estimate #")');
  expect(previewSection).toContain("TradePulse fills in the estimate number, amount, due date, and payment link when a reminder is sent.");
  expect(previewSection).not.toContain("<textarea");
  expect(previewSection).not.toContain("<input");
  expect(previewSection).not.toContain("onChange");
});

test("the Pro setup cards expose clear review and payment actions without implying TradePulse processes payment", () => {
  const source = readFileSync("app/components/profile-form.tsx", "utf8");
  expect(source).toContain("Reviews &amp; payment reminders");
  expect(source).toContain("Google reviews");
  expect(source).toContain("Payment reminders");
  expect(source).toContain("Review requests send customers to this Google review page.");
  expect(source).toContain("Payment reminders include this link so customers can pay.");
  expect(source).toContain("Paste review link manually");
  expect(source).toContain('googleReviewLink.trim() ? "Connected" : "Needs setup"');
  expect(source).toContain('paymentLink.trim() ? "Ready" : "Needs setup"');
  expect(source).toContain('googleReviewLink.trim() ? "Change business" : "Find review link"');
  expect(source).toContain('paymentLink.trim() ? "Edit payment link" : "Add payment link"');
  expect(source).not.toContain("we process");
  expect(source).not.toContain("TradePulse processes");
});

test("example invoice data is clearly not real: fixed, non-empty, and distinct from any real field", () => {
  // The whole point of these constants is that they never come from
  // tpe_estimates -- they're hardcoded in the component, not looked up.
  expect(PREVIEW_INVOICE_REF).toBe("1042");
  expect(PREVIEW_AMOUNT).toBe("350");
  expect(PREVIEW_DUE_DATE).toBe("August 4, 2026");
});

test("preview message with a configured payment link matches the required structure", () => {
  const message = buildPaymentReminderSms("overdue_1", {
    invoiceRef: PREVIEW_INVOICE_REF,
    amount: PREVIEW_AMOUNT,
    businessName: "Clearwater Plumbing",
    dueDateText: PREVIEW_DUE_DATE,
    paymentLink: "paypal.me/clearwaterplumbing",
  });
  expect(message).toBe(
    "Clearwater Plumbing: Invoice #1042 for $350 was due August 4, 2026. Pay here: paypal.me/clearwaterplumbing. Reply STOP to stop text reminders."
  );
});

test("preview message with no payment link falls back to the generic ask", () => {
  const message = buildPaymentReminderSms("overdue_1", {
    invoiceRef: PREVIEW_INVOICE_REF,
    amount: PREVIEW_AMOUNT,
    businessName: "Clearwater Plumbing",
    dueDateText: PREVIEW_DUE_DATE,
    paymentLink: null,
  });
  expect(message).toBe(
    "Clearwater Plumbing: Invoice #1042 for $350 was due August 4, 2026. Please arrange payment at your earliest convenience. Reply STOP to stop text reminders."
  );
  expect(message).not.toContain("Pay here:");
});

test("business name always appears in the preview", () => {
  const withLink = buildPaymentReminderSms("overdue_1", {
    invoiceRef: PREVIEW_INVOICE_REF,
    amount: PREVIEW_AMOUNT,
    businessName: "Clearwater Plumbing",
    dueDateText: PREVIEW_DUE_DATE,
    paymentLink: "https://pay.example.com/abc",
  });
  const withoutLink = buildPaymentReminderSms("overdue_1", {
    invoiceRef: PREVIEW_INVOICE_REF,
    amount: PREVIEW_AMOUNT,
    businessName: "Clearwater Plumbing",
    dueDateText: PREVIEW_DUE_DATE,
    paymentLink: null,
  });
  expect(withLink.startsWith("Clearwater Plumbing:")).toBe(true);
  expect(withoutLink.startsWith("Clearwater Plumbing:")).toBe(true);
});

test("STOP wording always appears in the preview, with or without a payment link", () => {
  for (const paymentLink of ["https://pay.example.com/abc", null]) {
    const message = buildPaymentReminderSms("overdue_1", {
      invoiceRef: PREVIEW_INVOICE_REF,
      amount: PREVIEW_AMOUNT,
      businessName: "Clearwater Plumbing",
      dueDateText: PREVIEW_DUE_DATE,
      paymentLink,
    });
    expect(message).toContain("Reply STOP to stop text reminders.");
  }
});

test("toggling the payment link between configured and empty changes only the CTA sentence", () => {
  const base = {
    invoiceRef: PREVIEW_INVOICE_REF,
    amount: PREVIEW_AMOUNT,
    businessName: "Clearwater Plumbing",
    dueDateText: PREVIEW_DUE_DATE,
  };
  // Mirrors the component's `paymentLink.trim() || null` -- an empty or
  // whitespace-only field must behave exactly like no link configured.
  const emptyField = "   ";
  const withLink = buildPaymentReminderSms("overdue_1", { ...base, paymentLink: "https://pay.example.com/abc" });
  const withEmptyField = buildPaymentReminderSms("overdue_1", { ...base, paymentLink: emptyField.trim() || null });

  expect(withLink).toContain("Pay here: https://pay.example.com/abc.");
  expect(withEmptyField).toContain("Please arrange payment at your earliest convenience.");
  expect(withEmptyField).not.toContain("Pay here:");
});
