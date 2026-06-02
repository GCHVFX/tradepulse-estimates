import { checkUserSubscriptionAccess } from "@/lib/auth";
import { logEstimateChange } from "@/lib/audit-log";
import { validateContentType } from "@/lib/api-utils";
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

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

  // Verify ownership of estimate
  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, customer_phone")
    .eq("id", estimateId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found" }, { status: 404 }));
  }

  // Look up business name to personalise the message
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle();

  const origin =
    request.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.trytradepulse.com";

  const shareUrl = `${origin}/share/${estimateId}`;

  const messageBody = business?.name
    ? `Your estimate from ${business.name} is ready. View it here: ${shareUrl}`
    : `Your estimate is ready. View it here: ${shareUrl}`;

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    let formattedPhone: string;
    try {
      formattedPhone = formatPhone(to);
    } catch (formatErr) {
      const message = formatErr instanceof Error ? formatErr.message : "Invalid phone number";
      return applyTo(NextResponse.json({ error: message }, { status: 400 }));
    }

    await client.messages.create({
      body: messageBody,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: formattedPhone,
    });

    const phoneUpdate = !estimate.customer_phone ? { customer_phone: to.trim() } : {};
    const { error: updateError } = await supabaseAdmin
      .from("tpe_estimates")
      .update({
        status: "sent",
        sent_via: "sms",
        sent_at: new Date().toISOString(),
        ...phoneUpdate,
      })
      .eq("id", estimateId)
      .eq("business_id", user.id);

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
