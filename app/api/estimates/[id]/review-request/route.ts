import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

function formatPhone(raw: string): string {
  if (!raw || typeof raw !== "string") throw new Error("Invalid phone number");
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return trimmed;
    throw new Error("Phone number format invalid");
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && !digits.startsWith("0")) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new Error("Phone number format not recognized. Use format like +1234567890 or 1234567890");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await params;

  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_FROM_NUMBER
  ) {
    return applyTo(NextResponse.json({ error: "SMS is not configured." }, { status: 500 }));
  }

  let requestMessageBody: string | null = null;
  let force = false;
  try {
    const body = await request.json() as { messageBody?: unknown; force?: unknown };
    if (typeof body.messageBody === "string") requestMessageBody = body.messageBody.trim();
    if (body.force === true) force = true;
  } catch {
    // Body is optional
  }

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id, customer_name, customer_phone, review_requested_at")
    .eq("id", id)
    .eq("business_id", user.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("plan, google_review_link, name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!business || business.plan !== "pro") {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  if (!business.google_review_link) {
    return applyTo(NextResponse.json({ error: "Google Review Link not set in Profile" }, { status: 400 }));
  }

  if (!estimate.customer_phone) {
    return applyTo(NextResponse.json({ error: "Customer phone number is required to send an SMS" }, { status: 400 }));
  }

  if (!force && estimate.review_requested_at) {
    return applyTo(NextResponse.json({ error: "Review request already sent" }, { status: 409 }));
  }

  if (requestMessageBody !== null && !requestMessageBody) {
    return applyTo(NextResponse.json({ error: "Message cannot be empty" }, { status: 400 }));
  }

  let formattedPhone: string;
  try {
    formattedPhone = formatPhone(estimate.customer_phone);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid phone number";
    return applyTo(NextResponse.json({ error: message }, { status: 400 }));
  }

  const customerName = estimate.customer_name?.trim() ?? "";
  const businessName = business.name?.trim() || "us";
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const defaultMessage = `${greeting}\n\nThanks for choosing ${businessName}. If anything wasn't right, reply to this text and we'll make it right.\n\nIf you have a moment, we'd appreciate a Google review.`;
  const smsBody = `${requestMessageBody ?? defaultMessage}\n\n${business.google_review_link}`;

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: smsBody,
      from: process.env.TWILIO_FROM_NUMBER,
      to: formattedPhone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMS send failed";
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }

  const { error: updateError } = await supabaseAdmin
    .from("tpe_estimates")
    .update({ review_requested_at: new Date().toISOString() })
    .eq("id", id)
    .eq("business_id", user.id);

  if (updateError) {
    return applyTo(NextResponse.json({ error: "SMS sent but failed to record timestamp" }, { status: 500 }));
  }

  return applyTo(NextResponse.json({ success: true }));
}
