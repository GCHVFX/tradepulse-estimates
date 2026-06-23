export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const client = new Anthropic();

const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[analyze-photos] ANTHROPIC_API_KEY is not set");
    return new NextResponse("Photo analysis is temporarily unavailable.", { status: 500 });
  }

  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, subscription_status, trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));

  const isActive = business.subscription_status === "active";
  const isTrialing = business.subscription_status === "trial" && business.trial_ends_at && new Date(business.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || business.subscription_status === "complimentary";
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  const { allowed } = await checkRateLimit(supabaseAdmin, user.id, "analyze-quote-photos", 10, 3600);
  if (!allowed) {
    return applyTo(NextResponse.json({ error: "Too many requests. Try again in a bit." }, { status: 429 }));
  }

  const { id: estimateId } = await params;

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id, description")
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) return applyTo(NextResponse.json({ error: "Estimate not found" }, { status: 404 }));

  const { data: photoRecords } = await supabaseAdmin
    .from("tpe_estimate_photos")
    .select("storage_path, mime_type")
    .eq("estimate_id", estimateId);

  if (!photoRecords || photoRecords.length === 0) {
    return applyTo(NextResponse.json({ description: "" }));
  }

  const content: Anthropic.ContentBlockParam[] = [];
  for (const record of photoRecords.slice(0, 5)) {
    const { data: fileData } = await supabaseAdmin.storage
      .from("tpe-estimate-photos")
      .download(record.storage_path);

    if (!fileData) continue;

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mediaType = ALLOWED_MEDIA_TYPES.includes(record.mime_type)
      ? record.mime_type as MediaType
      : "image/jpeg" as MediaType;

    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: base64 },
    });
  }

  if (content.length === 0) {
    return applyTo(NextResponse.json({ description: "" }));
  }

  const customerDesc = estimate.description ?? "";
  content.push({
    type: "text",
    text: `The customer submitted ${content.length} photo(s) with this quote request: "${customerDesc}"\n\nDescribe what you see in the photos that is relevant to the job. Be specific about visible damage, fixtures, or scope. Write 2-4 sentences a contractor would use to describe the work. Do not generate prices. Canadian English spelling.`,
  });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    const description = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return applyTo(NextResponse.json({ description: description || "" }));
  } catch (err) {
    const errStatus = (err as { status?: number }).status;
    if (errStatus === 401) {
      console.error("[analyze-photos] Anthropic API authentication failed. Check ANTHROPIC_API_KEY.");
    } else {
      console.error("[analyze-photos] vision request failed:", err instanceof Error ? err.message : err);
    }
    return applyTo(NextResponse.json({ description: "" }));
  }
}
