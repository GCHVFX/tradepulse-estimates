// Single production formatter for payment-reminder SMS text. Used today by
// app/api/cron/payment-reminders/route.ts; kept here (not inline in that
// route) specifically so a future contractor-facing message preview can
// import the exact same function instead of re-deriving the format.

export type PaymentReminderStage = "pre_due" | "overdue_1" | "overdue_2" | "overdue_ongoing";

export interface PaymentReminderMessageContext {
  /** Real invoice/estimate reference, e.g. estimate.id.slice(0, 8). Never
   * invent a value here -- pass through whatever the caller has. */
  invoiceRef: string;
  amount: string;
  /** Business name. Empty string omits the "Business: " lead-in entirely
   * rather than falling back to a placeholder like "your contractor". */
  businessName: string;
  dueDateText: string;
  /** tpe_businesses.payment_link, trimmed, or null when not configured. */
  paymentLink: string | null;
}

/**
 * Builds the outgoing SMS for one payment-reminder stage.
 *
 * Structure: "{Business}: Invoice #{ref} for ${amount} {stage lead-in
 * with date}. {payment CTA}. Reply STOP to stop text reminders."
 *
 * The payment CTA is one or the other, never both: "Pay here: {link}." when
 * a payment link is configured, "Please arrange payment at your earliest
 * convenience." when it is not. The STOP sentence is always present, in the
 * exact wording Twilio's Advanced Opt-Out and this app's own inbound-webhook
 * keyword fallback both recognize.
 */
export function buildPaymentReminderSms(
  stage: PaymentReminderStage,
  ctx: PaymentReminderMessageContext
): string {
  const { invoiceRef, amount, businessName, dueDateText, paymentLink } = ctx;
  const who = businessName ? `${businessName}: ` : "";
  const cta = paymentLink
    ? `Pay here: ${paymentLink}.`
    : "Please arrange payment at your earliest convenience.";

  const leadIn = (() => {
    switch (stage) {
      case "pre_due":
        return `is due ${dueDateText}.`;
      case "overdue_1":
        return `was due ${dueDateText}.`;
      case "overdue_2":
        return `remains outstanding as of ${dueDateText}.`;
      case "overdue_ongoing":
        return "remains unpaid.";
    }
  })();

  return `${who}Invoice #${invoiceRef} for $${amount} ${leadIn} ${cta} Reply STOP to stop text reminders.`;
}
