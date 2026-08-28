import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
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
import { readEstimateCurrencies } from "@/lib/currency-db";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { computeNextReminderStage, formatDueDateText } from "@/lib/payment-reminder-stage";
import { claimDelivery, markDeliverySent } from "@/lib/delivery-claims";
import { ESTIMATES_FROM } from "@/lib/email-addresses";

const MAX_REMINDERS_PER_RUN = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: estimates, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id, customer_name, customer_phone, customer_email, invoice_amount, due_date, reminder_count")
    .eq("payment_status", "unpaid")
    .not("due_date", "is", null)
    .not("invoice_amount", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!estimates || estimates.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  // One batch query, not one per estimate. Each reminder quotes the amount in
  // the estimate's own snapshot currency, never the business's current setting.
  const estimateCurrencies = await readEstimateCurrencies(
    supabaseAdmin,
    estimates.map((e) => e.id)
  );

  const businessIds = [...new Set(estimates.map((e) => e.business_id).filter((id): id is string => Boolean(id)))];
  const { data: businesses } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, payment_link, plan, subscription_status, trial_ends_at")
    .in("id", businessIds);

  // Payments is Pro-only, so only entitled businesses get reminders sent on
  // their behalf. Filtering the map here (rather than per estimate) keeps
  // this to the one batched lookup the cron already made, no extra queries.
  // Ineligible businesses are simply absent from the map, and the loop below
  // skips any estimate whose business is missing from it.
  const businessMap = new Map(
    (businesses ?? [])
      .filter((b) => hasProPaymentsAccess(b))
      .map((b) => [b.id, b])
  );

  const smsConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
  const twilioClient = smsConfigured
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const suppressionStore = createSupabaseSmsSuppressionStore(supabaseAdmin);

  let sent = 0;

  for (const estimate of estimates.slice(0, MAX_REMINDERS_PER_RUN)) {
    if (!estimate.business_id || !estimate.due_date || estimate.invoice_amount === null) continue;

    // Not entitled to Pro Payments (Starter, cancelled, past due, or an
    // expired trial), so send nothing on their behalf. This has to be an
    // explicit skip: the send path below reads the business with optional
    // chaining and falls back to "your contractor", so a missing business
    // would otherwise still deliver a reminder under a generic name.
    if (!businessMap.has(estimate.business_id)) continue;

    const next = computeNextReminderStage(estimate.due_date, estimate.reminder_count ?? 0);
    if (!next) continue;
    const { stage: stageName, nextReminderCount } = next;

    const business = businessMap.get(estimate.business_id);
    // "your contractor" is only for the email subject/body below, which
    // this task did not ask to change. buildPaymentReminderSms (lib/) is
    // meant to identify the actual business by name, never that
    // placeholder, so it gets the real name or an empty string -- see its
    // `who` handling for that case.
    const businessName = business?.name?.trim() || "your contractor";
    const smsBusinessName = business?.name?.trim() || "";
    const paymentLink = business?.payment_link?.trim() || null;

    const ctx: PaymentReminderEmailContext = {
      customerName: estimate.customer_name?.trim() || "there",
      invoiceRef: estimate.id.slice(0, 8),
      amount: estimate.invoice_amount.toFixed(2),
      currency: estimateCurrencies.get(estimate.id) ?? DEFAULT_CURRENCY,
      businessName,
      dueDateText: formatDueDateText(estimate.due_date),
      paymentLink,
    };

    const reminderRows: Array<{
      estimate_id: string;
      business_id: string;
      channel: string;
      stage: string;
      message: string;
    }> = [];

    if (twilioClient && estimate.customer_phone) {
      const formattedPhone = normalizePhoneE164(estimate.customer_phone);
      if (formattedPhone) {
        // Guard before ever calling Twilio: a recipient who replied STOP
        // must not receive another SMS, regardless of how the reminder
        // stage logic above evaluated. Skipping here (rather than treating
        // it as a failure) also leaves this channel out of reminderRows,
        // so no misleading "message sent" row is logged for it -- the
        // suppression row itself is the durable record of why nothing went
        // out, read back by the contractor-facing UI.
        const suppressed = await suppressionStore.isSuppressed(formattedPhone);
        if (suppressed) {
          console.info(`[payment-reminders] SMS skipped for estimate ${estimate.id}: recipient opted out`);
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
              businessId: estimate.business_id,
              estimateId: estimate.id,
              channel: "sms",
              recipient: formattedPhone,
              action: "payment-reminder",
              stage: `${stageName}:${nextReminderCount}`,
            });
            if (!claimId) {
              console.info(`[payment-reminders] duplicate SMS claim skipped for estimate ${estimate.id}`);
            } else {
              await twilioClient.messages.create({
                body: smsBody,
                from: process.env.TWILIO_FROM_NUMBER,
                to: formattedPhone,
              });
              await markDeliverySent(supabaseAdmin, claimId);
              reminderRows.push({
                estimate_id: estimate.id,
                business_id: estimate.business_id,
                channel: "sms",
                stage: stageName,
                message: smsBody,
              });
            }
          } catch (err) {
            // Twilio reporting 21610 typically means the inbound STOP
            // webhook hasn't recorded it locally yet, or arrived out of
            // order. Record suppression defensively (idempotent -- a repeat
            // 21610 for an already-suppressed number is a no-op) so the next
            // run and the contractor UI pick it up without retrying.
            const optedOut = await recordSuppressionIfUnsubscribedError(suppressionStore, formattedPhone, err);
            if (optedOut) {
              console.warn(`[payment-reminders] Twilio reports opted-out recipient for estimate ${estimate.id}`);
            } else {
              console.error(`[payment-reminders] SMS failed for estimate ${estimate.id}:`, err);
            }
          }
        }
      }
    }

    if (resend && estimate.customer_email?.trim()) {
      const html = buildPaymentReminderEmailHtml(stageName, ctx);
      try {
        const recipient = estimate.customer_email.trim().toLowerCase();
        const claimId = await claimDelivery(supabaseAdmin, {
          businessId: estimate.business_id,
          estimateId: estimate.id,
          channel: "email",
          recipient,
          action: "payment-reminder",
          stage: `${stageName}:${nextReminderCount}`,
        });
        if (!claimId) {
          console.info(`[payment-reminders] duplicate email claim skipped for estimate ${estimate.id}`);
        } else {
          const result = await resend.emails.send({
            from: ESTIMATES_FROM,
            to: recipient,
            subject: `Invoice reminder -- ${businessName}`,
            html,
          });
          if (result.error) {
            console.error(`[payment-reminders] email failed for estimate ${estimate.id}:`, result.error);
          } else {
            await markDeliverySent(supabaseAdmin, claimId);
            reminderRows.push({
              estimate_id: estimate.id,
              business_id: estimate.business_id,
              channel: "email",
              stage: stageName,
              message: buildPaymentReminderEmailBody(stageName, ctx),
            });
          }
        }
      } catch (err) {
        console.error(`[payment-reminders] email failed for estimate ${estimate.id}:`, err);
      }
    }

    if (reminderRows.length === 0) continue;

    const { error: updateError } = await supabaseAdmin
      .from("tpe_estimates")
      .update({
        last_reminder_sent_at: new Date().toISOString(),
        reminder_count: nextReminderCount,
      })
      .eq("id", estimate.id);

    if (updateError) {
      console.error(`[payment-reminders] update failed for estimate ${estimate.id}:`, updateError.message);
    }

    const { error: insertError } = await supabaseAdmin
      .from("tpe_payment_reminders")
      .insert(reminderRows);

    if (insertError) {
      console.error(`[payment-reminders] insert failed for estimate ${estimate.id}:`, insertError.message);
    }

    sent++;
  }

  return NextResponse.json({ sent });
}
