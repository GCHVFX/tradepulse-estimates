import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";

type StageName = "pre_due" | "overdue_1" | "overdue_2" | "overdue_ongoing";

// Offsets are days relative to the due date. A stage is eligible once
// today >= due_date + offsetDays. reminder_count tracks how many stages
// have been sent, so each stage fires at most once per invoice.
const STAGES: Array<{ name: StageName; offsetDays: number }> = [
  { name: "pre_due", offsetDays: -2 },
  { name: "overdue_1", offsetDays: 1 },
  { name: "overdue_2", offsetDays: 5 },
];

// After the named stages, keep reminding weekly until paid. The first
// ongoing reminder fires at due_date + ONGOING_START_DAYS, then every
// ONGOING_INTERVAL_DAYS after that.
const ONGOING_START_DAYS = 14;
const ONGOING_INTERVAL_DAYS = 7;

interface MessageContext {
  customerName: string;
  invoiceRef: string;
  amount: string;
  businessName: string;
  dueDateText: string;
  paymentLink: string | null;
  daysOverdue: number;
}

function formatPhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? trimmed : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && !digits.startsWith("0")) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function buildSmsMessage(stage: StageName, ctx: MessageContext): string {
  const { customerName, invoiceRef, amount, businessName, dueDateText, paymentLink } = ctx;
  switch (stage) {
    case "pre_due":
      return `Hi ${customerName}, just a reminder that invoice #${invoiceRef} for $${amount} from ${businessName} is due on ${dueDateText}.${paymentLink ? ` Pay here: ${paymentLink}.` : ""} Reply STOP to opt out.`;
    case "overdue_1":
      return `Hi ${customerName}, your invoice of $${amount} from ${businessName} was due ${dueDateText}. ${paymentLink ? `Please arrange payment at your earliest convenience: ${paymentLink}.` : "Please arrange payment at your earliest convenience."} Reply STOP to opt out.`;
    case "overdue_2":
      return `Hi ${customerName}, invoice #${invoiceRef} for $${amount} remains outstanding as of ${dueDateText}. ${paymentLink ? `Please contact us or pay here: ${paymentLink}.` : "Please contact us."} Reply STOP to opt out.`;
    case "overdue_ongoing":
      return `Hi ${customerName}, invoice #${invoiceRef} for $${amount} from ${businessName} remains unpaid.${paymentLink ? ` Pay here: ${paymentLink}.` : ""} Reply STOP to opt out.`;
  }
}

function buildEmailBody(stage: StageName, ctx: MessageContext): string {
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

function buildEmailHtml(stage: StageName, ctx: MessageContext): string {
  const { invoiceRef, amount, businessName, dueDateText, paymentLink } = ctx;
  const isUrl = paymentLink ? /^https?:\/\//i.test(paymentLink) : false;
  const paymentBlock = paymentLink
    ? isUrl
      ? `<a href="${paymentLink}" style="display: inline-block; background: #f59e0b; color: #111; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 10px; text-decoration: none; margin-top: 8px;">Pay Now</a>
         <p style="font-size: 13px; color: #888; margin: 16px 0 0;">Or copy this link: ${paymentLink}</p>`
      : `<p style="font-size: 15px; margin: 16px 0 0;">Pay here: ${paymentLink}</p>`
    : "";

  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
      <p style="font-size: 16px; margin: 0 0 16px;">${buildEmailBody(stage, ctx)}</p>
      <div style="background: #f4f4f5; border-radius: 10px; padding: 16px 20px; margin: 0 0 16px;">
        <p style="font-size: 14px; margin: 0 0 6px;"><strong>Invoice #:</strong> ${invoiceRef}</p>
        <p style="font-size: 14px; margin: 0 0 6px;"><strong>Amount:</strong> $${amount}</p>
        <p style="font-size: 14px; margin: 0 0 6px;"><strong>Due date:</strong> ${dueDateText}</p>
        <p style="font-size: 14px; margin: 0;"><strong>From:</strong> ${businessName}</p>
      </div>
      ${paymentBlock}
    </div>
  `;
}

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

  const businessIds = [...new Set(estimates.map((e) => e.business_id).filter((id): id is string => Boolean(id)))];
  const { data: businesses } = await supabaseAdmin
    .from("tpe_businesses")
    .select("user_id, name, payment_link")
    .in("user_id", businessIds);

  const businessMap = new Map(
    (businesses ?? []).map((b) => [b.user_id, b])
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

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const msPerDay = 24 * 60 * 60 * 1000;

  let sent = 0;

  for (const estimate of estimates) {
    if (!estimate.business_id || !estimate.due_date || estimate.invoice_amount === null) continue;

    const [year, month, day] = estimate.due_date.slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) continue;
    const dueUtc = Date.UTC(year, month - 1, day);
    const daysFromDue = Math.floor((todayUtc - dueUtc) / msPerDay);

    const stagesSent = estimate.reminder_count ?? 0;

    let stageName: StageName | null = null;
    let nextReminderCount = stagesSent;

    if (stagesSent < STAGES.length) {
      // Named stages: pre_due, overdue_1, overdue_2
      let stageIndex = -1;
      for (let i = 0; i < STAGES.length; i++) {
        if (daysFromDue >= STAGES[i].offsetDays) stageIndex = i;
      }
      if (stageIndex >= 0 && stagesSent <= stageIndex) {
        stageName = STAGES[stageIndex].name;
        nextReminderCount = stageIndex + 1;
      }
    } else {
      // All named stages sent. Keep reminding weekly until paid.
      const weeklySent = stagesSent - STAGES.length;
      if (daysFromDue >= ONGOING_START_DAYS + ONGOING_INTERVAL_DAYS * weeklySent) {
        stageName = "overdue_ongoing";
        nextReminderCount = stagesSent + 1;
      }
    }

    if (!stageName) continue;

    const business = businessMap.get(estimate.business_id);
    const businessName = business?.name?.trim() || "your contractor";
    const paymentLink = business?.payment_link?.trim() || null;

    const ctx: MessageContext = {
      customerName: estimate.customer_name?.trim() || "there",
      invoiceRef: estimate.id.slice(0, 8),
      amount: estimate.invoice_amount.toFixed(2),
      businessName,
      dueDateText: new Date(dueUtc).toLocaleDateString("en-CA", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
      paymentLink,
      daysOverdue: Math.max(daysFromDue, 0),
    };

    const reminderRows: Array<{
      estimate_id: string;
      business_id: string;
      channel: string;
      stage: string;
      message: string;
    }> = [];

    if (twilioClient && estimate.customer_phone) {
      const formattedPhone = formatPhone(estimate.customer_phone);
      if (formattedPhone) {
        const smsBody = buildSmsMessage(stageName, ctx);
        try {
          await twilioClient.messages.create({
            body: smsBody,
            from: process.env.TWILIO_FROM_NUMBER,
            to: formattedPhone,
          });
          reminderRows.push({
            estimate_id: estimate.id,
            business_id: estimate.business_id,
            channel: "sms",
            stage: stageName,
            message: smsBody,
          });
        } catch (err) {
          console.error(`[payment-reminders] SMS failed for estimate ${estimate.id}:`, err);
        }
      }
    }

    if (resend && estimate.customer_email?.trim()) {
      const html = buildEmailHtml(stageName, ctx);
      try {
        const result = await resend.emails.send({
          from: "TradePulse Estimates <estimates@trytradepulse.com>",
          to: estimate.customer_email.trim(),
          subject: `Invoice reminder -- ${businessName}`,
          html,
        });
        if (result.error) {
          console.error(`[payment-reminders] email failed for estimate ${estimate.id}:`, result.error);
        } else {
          reminderRows.push({
            estimate_id: estimate.id,
            business_id: estimate.business_id,
            channel: "email",
            stage: stageName,
            message: buildEmailBody(stageName, ctx),
          });
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
