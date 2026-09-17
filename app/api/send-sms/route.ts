import { checkUserSubscriptionAccess } from "@/lib/auth";
import { logEstimateChange } from "@/lib/audit-log";
import { validateContentType } from "@/lib/api-utils";
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { claimDelivery, markDeliverySent } from "@/lib/delivery-claims";
import { classifyEstimate } from "@/lib/estimate-classification";
import { isDeliveredContractorPricing } from "@/lib/estimate-delivery";
import { contractorPricingCompleteness } from "@/lib/estimate-pricing-server";
import {
  normalizePhoneE164,
  createSupabaseSmsSuppressionStore,
  recordSuppressionIfUnsubscribedError,
  SMS_OPTED_OUT_MESSAGE,
  SMS_OPTED_OUT_CODE,
} from "@/lib/sms-suppression";
import { canonicalUrl } from "@/lib/site-url";
import { resolveTwilioSendAddress } from "@/lib/twilio-send";

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
    .select(
      "id, customer_phone, customer_name, sent_at, copied_at, pricing_source, source, status, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot"
    )
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found" }, { status: 404 }));
  }

  // Classification first (specs/contractor-owned-pricing.md section 2), then
  // the same completeness gate PATCH /api/estimates and send-email share
  // (section 13). A legacy or unpriced inbound estimate is untouched by this
  // check. No side effect has happened yet: nothing is claimed, nothing sent.
  const pricingClass = classifyEstimate(estimate);
  if (pricingClass === "contractor_pricing") {
    const pricing = await contractorPricingCompleteness(estimateId, estimate);
    if (!pricing.complete) {
      return applyTo(
        NextResponse.json(
          { error: "This estimate is missing pricing information and cannot be sent yet" },
          { status: 409 }
        )
      );
    }
  }

  // Pinned to the canonical host, never SITE_URL. A share link is a
  // permanent artifact that ends up sitting in a customer's phone, so it
  // must never resolve to a Vercel deployment URL or a stale env value. A
  // contractor signed in on a retired alias domain would otherwise mint
  // share links on that alias too, and those links live in inboxes forever.
  const shareUrl = canonicalUrl(`/share/${estimateId}`);

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
      stage: estimate.sent_at ? `resend-${estimate.sent_at}` : "initial",
    });
  } catch {
    return applyTo(NextResponse.json({ error: "Unable to prepare SMS delivery" }, { status: 503 }));
  }
  if (!claimId) {
    return applyTo(NextResponse.json({ error: "This SMS send is already in progress" }, { status: 409 }));
  }

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    try {
      await client.messages.create({
        body: messageBody,
        to: formattedPhone,
        ...resolveTwilioSendAddress(process.env),
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

    // A contractor_pricing estimate already delivered through some other
    // channel (e.g. copy link, with no phone ever entered) must not have its
    // customer-visible document silently gain a phone number now -- the
    // share page renders customer_phone when present, so this is a document
    // edit, not a delivery-mechanics detail. Undelivered and legacy/inbound
    // estimates are unaffected: this only ever skips a write that would
    // otherwise happen, never blocks the send itself.
    const lockCustomerDetails = isDeliveredContractorPricing(estimate);
    const phoneUpdate =
      !estimate.customer_phone && !lockCustomerDetails ? { customer_phone: formattedPhone } : {};
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
