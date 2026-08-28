import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { Resend } from "resend";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { hasProPaymentsAccess } from "@/lib/auth";
import {
  normalizePhoneE164,
  createSupabaseSmsSuppressionStore,
  recordSuppressionIfUnsubscribedError,
} from "@/lib/sms-suppression";
import {
  buildPaymentReminderSms,
  buildPaymentReminderEmailBody,
  buildPaymentReminderEmailHtml,
  type PaymentReminderEmailContext,
} from "@/lib/payment-reminder-message";
import { readEstimateCurrency } from "@/lib/currency-db";
import { selectManualReminderStage, formatDueDateText } from "@/lib/payment-reminder-stage";
import { claimDelivery, markDeliverySent } from "@/lib/delivery-claims";
import { resolveTwilioSendAddress, hasUsableTwilioSender } from "@/lib/twilio-send";
import { ESTIMATES_FROM } from "@/lib/email-addresses";

type SmsOutcome = "sent" | "suppressed" | "no_phone" | "not_configured" | "failed";
type EmailOutcome = "sent" | "no_email" | "not_configured" | "failed";

/**
 * Manually sends the payment reminder for exactly one invoice, on demand,
 * without running the global daily cron. Reuses every production primitive
 * app/api/cron/payment-reminders/route.ts uses (stage selection, message
 * builders, suppression guard, 21610 handling) so a manual send can never
 * produce a different message or bypass a safeguard the automated path has.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await params;

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, payment_link, plan, subscription_status, trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  }

  if (!hasProPaymentsAccess(business)) {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  // Ownership enforced by matching both id and business_id in one query --
  // this can only ever address one estimate belonging to the caller's own
  // business, never a neighbour's.
  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id, customer_name, customer_phone, customer_email, invoice_amount, due_date, payment_status, reminder_count")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  if (estimate.payment_status !== "unpaid") {
    return applyTo(NextResponse.json({ error: "This invoice is not unpaid.", code: "not_unpaid" }, { status: 409 }));
  }
  if (estimate.invoice_amount === null) {
    return applyTo(NextResponse.json({ error: "Invoice amount is missing.", code: "missing_amount" }, { status: 400 }));
  }
  if (!estimate.due_date) {
    return applyTo(NextResponse.json({ error: "Due date is missing.", code: "missing_due_date" }, { status: 400 }));
  }

  const currentReminderCount = estimate.reminder_count ?? 0;
  // Deliberately not gated by the automatic schedule: "Send Reminder Now" is
  // an on-demand action, so it always sends, using whichever existing
  // wording matches the invoice's current relationship to its due date. See
  // selectManualReminderStage() for exactly how the stage and the resulting
  // reminder_count are chosen, and why that choice keeps the next cron run
  // from resending the identical wording.
  const next = selectManualReminderStage(estimate.due_date, currentReminderCount);
  if (!next) {
    return applyTo(NextResponse.json({ error: "Invalid due date.", code: "invalid_due_date" }, { status: 400 }));
  }
  const { stage: stageName, nextReminderCount } = next;

  const businessName = business.name?.trim() || "your contractor";
  const smsBusinessName = business.name?.trim() || "";
  const paymentLink = business.payment_link?.trim() || null;

  const ctx: PaymentReminderEmailContext = {
    customerName: estimate.customer_name?.trim() || "there",
    invoiceRef: estimate.id.slice(0, 8),
    amount: estimate.invoice_amount.toFixed(2),
    currency: await readEstimateCurrency(supabaseAdmin, estimate.id),
    businessName,
    dueDateText: formatDueDateText(estimate.due_date),
    paymentLink,
  };

  const smsConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    hasUsableTwilioSender(process.env)
  );
  const twilioClient = smsConfigured
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const suppressionStore = createSupabaseSmsSuppressionStore(supabaseAdmin);

  const reminderRows: Array<{
    estimate_id: string;
    business_id: string;
    channel: string;
    stage: string;
    message: string;
  }> = [];

  let smsOutcome: SmsOutcome;
  if (!estimate.customer_phone) {
    smsOutcome = "no_phone";
  } else if (!twilioClient) {
    smsOutcome = "not_configured";
  } else {
    const formattedPhone = normalizePhoneE164(estimate.customer_phone);
    if (!formattedPhone) {
      smsOutcome = "failed";
    } else {
      // Same guard as every other SMS path: never call Twilio for a
      // suppressed recipient, whether this send is automated or manual.
      const suppressed = await suppressionStore.isSuppressed(formattedPhone);
      if (suppressed) {
        smsOutcome = "suppressed";
      } else {
        const smsBody = buildPaymentReminderSms(stageName, {
          invoiceRef: ctx.invoiceRef,
          amount: ctx.amount,
          businessName: smsBusinessName,
          dueDateText: ctx.dueDateText,
          paymentLink: ctx.paymentLink,
        });
        try {
          const claimId = await claimDelivery(supabaseAdmin, {
            businessId: business.id,
            estimateId: estimate.id,
            channel: "sms",
            recipient: formattedPhone,
            action: "payment-reminder",
            stage: `${stageName}:${nextReminderCount}`,
          });
          if (!claimId) {
            smsOutcome = "failed";
          } else {
            await twilioClient.messages.create({
              body: smsBody,
              to: formattedPhone,
              ...resolveTwilioSendAddress(process.env),
            });
            await markDeliverySent(supabaseAdmin, claimId);
            smsOutcome = "sent";
            reminderRows.push({
              estimate_id: estimate.id,
              business_id: business.id,
              channel: "sms",
              stage: stageName,
              message: smsBody,
            });
          }
        } catch (err) {
          const optedOut = await recordSuppressionIfUnsubscribedError(suppressionStore, formattedPhone, err);
          smsOutcome = optedOut ? "suppressed" : "failed";
          if (!optedOut) console.error(`[send-reminder] SMS failed for estimate ${estimate.id}:`, err);
        }
      }
    }
  }

  let emailOutcome: EmailOutcome;
  if (!estimate.customer_email?.trim()) {
    emailOutcome = "no_email";
  } else if (!resend) {
    emailOutcome = "not_configured";
  } else {
    const html = buildPaymentReminderEmailHtml(stageName, ctx);
    try {
      const recipient = estimate.customer_email.trim().toLowerCase();
      const claimId = await claimDelivery(supabaseAdmin, {
        businessId: business.id,
        estimateId: estimate.id,
        channel: "email",
        recipient,
        action: "payment-reminder",
        stage: `${stageName}:${nextReminderCount}`,
      });
      if (!claimId) {
        emailOutcome = "failed";
      } else {
        const result = await resend.emails.send({
          from: ESTIMATES_FROM,
          to: recipient,
          subject: `Invoice reminder -- ${businessName}`,
          html,
        });
        if (result.error) {
          emailOutcome = "failed";
          console.error(`[send-reminder] email failed for estimate ${estimate.id}:`, result.error);
        } else {
          await markDeliverySent(supabaseAdmin, claimId);
          emailOutcome = "sent";
          reminderRows.push({
            estimate_id: estimate.id,
            business_id: business.id,
            channel: "email",
            stage: stageName,
            message: buildPaymentReminderEmailBody(stageName, ctx),
          });
        }
      }
    } catch (err) {
      emailOutcome = "failed";
      console.error(`[send-reminder] email failed for estimate ${estimate.id}:`, err);
    }
  }

  if (reminderRows.length === 0) {
    // Nothing actually went out on any channel -- reminder_count and
    // last_reminder_sent_at are left exactly as they were.
    return applyTo(NextResponse.json({ smsOutcome, emailOutcome, sent: false }));
  }

  // Optimistic concurrency: only advance reminder_count if it's still what
  // we read it as. If a concurrent request (a duplicate tap, or the daily
  // cron landing at the same moment) already advanced it, this update
  // becomes a no-op instead of a second, conflicting advance -- the same
  // compare-and-swap pattern lib/sms-suppression.ts already uses.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tpe_estimates")
    .update({
      last_reminder_sent_at: new Date().toISOString(),
      reminder_count: nextReminderCount,
    })
    .eq("id", estimate.id)
    .eq("business_id", business.id)
    .eq("reminder_count", currentReminderCount)
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error(`[send-reminder] update failed for estimate ${estimate.id}:`, updateError.message);
  }

  const { error: insertError } = await supabaseAdmin
    .from("tpe_payment_reminders")
    .insert(reminderRows);

  if (insertError) {
    console.error(`[send-reminder] insert failed for estimate ${estimate.id}:`, insertError.message);
  }

  return applyTo(NextResponse.json({ smsOutcome, emailOutcome, sent: true, alreadyAdvancedByAnotherRequest: !updated }));
}
