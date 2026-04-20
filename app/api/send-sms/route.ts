import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("61")) return `+${digits}`;
  if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
  return `+${digits}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

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

  // Look up business name to personalise the message
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle();

  const origin =
    request.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://tradepulse.app";

  const shareUrl = `${origin}/share/${estimateId}`;

  const messageBody = business?.name
    ? `Your estimate from ${business.name} is ready. View it here: ${shareUrl}`
    : `Your estimate is ready. View it here: ${shareUrl}`;

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    await client.messages.create({
      body: messageBody,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: formatPhone(to),
    });

    await supabaseAdmin
      .from("tpe_estimates")
      .update({
        status: "sent",
        sent_via: "sms",
        sent_at: new Date().toISOString(),
      })
      .eq("id", estimateId)
      .eq("business_id", user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SMS send failed";
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }

  return applyTo(NextResponse.json({ success: true }));
}
