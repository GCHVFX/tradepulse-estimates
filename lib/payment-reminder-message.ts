// Single production formatter for payment-reminder SMS text. Used today by
// app/api/cron/payment-reminders/route.ts; kept here (not inline in that
// route) specifically so a future contractor-facing message preview can
// import the exact same function instead of re-deriving the format.

import { DEFAULT_CURRENCY, currencyPrefix, type Currency } from "./currency";

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
  /**
   * The estimate's own currency snapshot. Amounts a customer receives must
   * never be an ambiguous bare "$". Defaults to CAD for estimates saved
   * before the currency columns existed.
   */
  currency?: Currency;
}

/**
 * Builds the outgoing SMS for one payment-reminder stage.
 *
 * Structure: "{Business}: Invoice #{ref} for CA$/US${amount} {stage lead-in
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
  const money = `${currencyPrefix(ctx.currency ?? DEFAULT_CURRENCY)}${amount}`;
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

  return `${who}Invoice #${invoiceRef} for ${money} ${leadIn} ${cta} Reply STOP to stop text reminders.`;
}

export interface PaymentReminderEmailContext extends PaymentReminderMessageContext {
  customerName: string;
}

/**
 * Plain-text body for the reminder email, used both as the email's own
 * text fallback and as the `message` stored in tpe_payment_reminders for
 * the email channel. Unlike the SMS builder, this keeps the existing
 * "your contractor" fallback for a blank business name -- unrelated to the
 * SMS opt-out work, not something any task asked to change.
 */
export function buildPaymentReminderEmailBody(
  stage: PaymentReminderStage,
  ctx: PaymentReminderEmailContext
): string {
  const { customerName, dueDateText, businessName } = ctx;
  switch (stage) {
    case "pre_due":
      return `Hi ${customerName}, just a reminder that the invoice below from ${businessName} is due on ${dueDateText}.`;
    case "overdue_1":
      return `Hi ${customerName}, the invoice below from ${businessName} was due ${dueDateText}. Please arrange payment at your earliest convenience.`;
    case "overdue_2":
      return `Hi ${customerName}, the invoice below remains outstanding as of ${dueDateText}. Please contact us or arrange payment.`;
    case "overdue_ongoing":
      return `Hi ${customerName}, the invoice below from ${businessName} remains unpaid. Please contact us or arrange payment.`;
  }
}

/** HTML email body wrapping buildPaymentReminderEmailBody() with the
 * invoice summary block and, when configured, a "Pay Now" button. */
export function buildPaymentReminderEmailHtml(
  stage: PaymentReminderStage,
  ctx: PaymentReminderEmailContext
): string {
  const { invoiceRef, amount, businessName, dueDateText, paymentLink } = ctx;
  const money = `${currencyPrefix(ctx.currency ?? DEFAULT_CURRENCY)}${amount}`;
  const isUrl = paymentLink ? /^https?:\/\//i.test(paymentLink) : false;
  const paymentBlock = paymentLink
    ? isUrl
      ? `<a href="${paymentLink}" style="display: inline-block; background: #f59e0b; color: #111; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 10px; text-decoration: none; margin-top: 8px;">Pay Now</a>
         <p style="font-size: 13px; color: #888; margin: 16px 0 0;">Or copy this link: ${paymentLink}</p>`
      : `<p style="font-size: 15px; margin: 16px 0 0;">Pay here: ${paymentLink}</p>`
    : "";

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
      <p style="font-size: 16px; margin: 0 0 16px;">${buildPaymentReminderEmailBody(stage, ctx)}</p>
      <div style="background: #f4f4f5; border-radius: 10px; padding: 16px 20px; margin: 0 0 16px;">
        <p style="font-size: 14px; margin: 0 0 6px;"><strong>Invoice #:</strong> ${invoiceRef}</p>
        <p style="font-size: 14px; margin: 0 0 6px;"><strong>Amount:</strong> ${money}</p>
        <p style="font-size: 14px; margin: 0 0 6px;"><strong>Due date:</strong> ${dueDateText}</p>
        <p style="font-size: 14px; margin: 0;"><strong>From:</strong> ${businessName}</p>
      </div>
      ${paymentBlock}
    </div>
  `;
}
