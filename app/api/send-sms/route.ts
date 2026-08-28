import { checkUserSubscriptionAccess } from "@/lib/auth";
import { logEstimateChange } from "@/lib/audit-log";
import { validateContentType } from "@/lib/api-utils";
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { claimDelivery, markDeliverySent } from "@/lib/delivery-claims";
import {
  normalizePhoneE164,
  createSupabaseSmsSuppressionStore,
  recordSuppressionIfUnsubscribedError,
  SMS_OPTED_OUT_MESSAGE,
  SMS_OPTED_OUT_CODE,
} from "@/lib/sms-suppression";
import { SITE_URL } from "@/lib/site-url";

function formatPhone(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error("Invalid phone number");
  }

  const trimmed = raw.trim();

  // If already has leading +, validate and return
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      return trimmed;
    }
    throw new Error("Phone number format invalid");
  }

  const digits = trimmed.replace(/\D/g, "");

  // North America: 10 or 11 digits
  if (digits.length === 10 && !digits.startsWith("0")) {
    return `+1${digits}`;
  }
  if (digits.startsWith("1") && digits.length === 11) {
    return `+${digits}`;
  }

  // Australia: handle various formats
  if (digits.startsWith("04") && digits.length === 10) {
    return `+61${digits.slice(1)}`;
  }
  if (digits.startsWith("4") && digits.length === 9) {
    return `+61${digits}`;
  }

  // Generic: if it looks like a valid international number, add +
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  throw new Error("Phone number format not recognized. Use format like +1234567890 or 1234567890");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const { to, estimateId } = body as { to?: unknown; estimateId?: unknown };

  if (typeof to !== "string" || !to.trim()) {
    return applyTo(NextResponse.json({ error: "Phone number is required" }, { status: 400 }));
  }
  if (typeof estimateId !== "string" || !estimateId.trim()) {
    return applyTo(NextResponse.json({ error: "estimateId is required" }, { status: 400 }));
  }

const { hasAccess } = await checkUserSubscriptionAccess(user.id, supabaseAdmin);
if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  // Look up business to get id and name
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  }

  // Verify ownership of estimate
  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, customer_phone, customer_name")
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found" }, { status: 404 }));
  }

  // Pinned to the canonical host rather than the request origin. A
  // contractor signed in on a retired alias domain would otherwise mint share
  // links on that alias, and those links live in customer inboxes forever.
  const shareUrl = `${SITE_URL}/share/${estimateId}`;

  const customerName = (estimate.customer_name ?? "").trim();
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const bizName = business?.name ?? "";
  const messageBody = bizName
    ? `${greeting} ${bizName} has sent you an estimate: ${shareUrl}`
    : `${greeting} your estimate is ready: ${shareUrl}`;

  let suppliedPhone: string;
  try {
    suppliedPhone = formatPhone(to);
  } catch (formatErr) {
    const message = formatErr instanceof Error ? formatErr.message : "Invalid phone number";
    return applyTo(NextResponse.json({ error: message }, { status: 400 }));
  }

  let formattedPhone = suppliedPhone;
  if (estimate.customer_phone) {
    try {
      formattedPhone = formatPhone(estimate.customer_phone);
    } catch {
      return applyTo(NextResponse.json({ error: "Stored customer phone is invalid" }, { status: 400 }));
    }
    if (formattedPhone !== suppliedPhone) {
      return applyTo(NextResponse.json({ error: "Use the customer phone saved on this estimate" }, { status: 400 }));
    }
  }

  const suppressionStore = createSupabaseSmsSuppressionStore(supabaseAdmin);
  const suppressionKey = normalizePhoneE164(formattedPhone) ?? formattedPhone;

  // Manually triggered sends must respect suppression exactly like automated
  // ones: no call to Twilio at all for an opted-out number, and this is
  // reported as a distinct, clear result rather than a generic send
  // failure. Estimate/customer state is untouched -- only the response
  // differs from the success path below.
  if (await suppressionStore.isSuppressed(suppressionKey)) {
    return applyTo(
      NextResponse.json({ error: SMS_OPTED_OUT_MESSAGE, code: SMS_OPTED_OUT_CODE }, { status: 409 })
    );
  }

  let claimId: string | null;
  try {
    claimId = await claimDelivery(supabaseAdmin, {
      businessId: business.id,
      estimateId,
      channel: "sms",
      recipient: suppressionKey,
      action: "estimate-send",
      stage: "initial",
    });
  } catch {
    return applyTo(NextResponse.json({ error: "Unable to prepare SMS delivery" }, { status: 503 }));
  }
  if (!claimId) {
    return applyTo(NextResponse.json({ error: "This estimate was already sent by SMS to this customer" }, { status: 409 }));
  }

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    try {
      await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_FROM_NUMBER!,
        to: formattedPhone,
      });
    } catch (sendErr) {
      const optedOut = await recordSuppressionIfUnsubscribedError(suppressionStore, suppressionKey, sendErr);
      if (optedOut) {
        return applyTo(
          NextResponse.json({ error: SMS_OPTED_OUT_MESSAGE, code: SMS_OPTED_OUT_CODE }, { status: 409 })
        );
      }
      throw sendErr;
    }

    await markDeliverySent(supabaseAdmin, claimId);

    const phoneUpdate = !estimate.customer_phone ? { customer_phone: formattedPhone } : {};
    const { error: updateError } = await supabaseAdmin
      .from("tpe_estimates")
      .update({
        status: "sent",
        sent_via: "sms",
        sent_at: new Date().toISOString(),
        ...phoneUpdate,
      })
      .eq("id", estimateId)
      .eq("business_id", business.id);

    if (updateError) {
      console.error("[send-sms] update failed:", updateError.message);
      return applyTo(NextResponse.json({ error: "Failed to update estimate" }, { status: 500 }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMS send failed";
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }

  // Log SMS send
  await logEstimateChange(
    supabaseAdmin,
    estimateId,
    user.id,
    "sent",
    undefined,
    { sent_via: "sms", sent_at: new Date().toISOString() }
  );

  return applyTo(NextResponse.json({ success: true }));
}
