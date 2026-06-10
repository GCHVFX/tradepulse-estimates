export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import { validateContentType } from "@/lib/api-utils";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const client = new Anthropic();

const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

// ~6MB of base64, comfortably under the Anthropic 5MB decoded image limit
const MAX_BASE64_LENGTH = 7_000_000;

const SYSTEM_PROMPT = `You are a trades estimating assistant helping a contractor describe a job from a photo.
Look at this job site photo and describe what work needs to be done in plain language.
Write it the way a contractor would describe it to get a quote -- specific, direct, no fluff.
Include: what needs to be fixed or installed, visible damage or scope, approximate size or quantity where visible.
Flag anything unclear that the contractor should verify in person.
Keep it under 200 words. Do not generate prices. Do not write an estimate. Just describe the visible work.
Use Canadian English spelling.`;

export async function POST(request: NextRequest) {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!business || business.plan !== "pro") {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  const { allowed } = await checkRateLimit(supabaseAdmin, user.id, "analyze-photo", 5, 3600);
  if (!allowed) {
    return applyTo(
      NextResponse.json({ error: "Too many photos. Try again in a bit." }, { status: 429 })
    );
  }

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid JSON" }, { status: 400 }));
  }

  const { imageBase64, mediaType } = body as { imageBase64?: unknown; mediaType?: unknown };

  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    return applyTo(NextResponse.json({ error: "imageBase64 is required" }, { status: 400 }));
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return applyTo(
      NextResponse.json({ error: "Photo is too large. Try a smaller photo." }, { status: 400 })
    );
  }
  if (
    typeof mediaType !== "string" ||
    !ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)
  ) {
    return applyTo(
      NextResponse.json({ error: "Photo must be a JPEG, PNG, WebP, or GIF" }, { status: 400 })
    );
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as AllowedMediaType,
                data: imageBase64,
              },
            },
            { type: "text", text: "Describe the work shown in this job site photo." },
          ],
        },
      ],
    });

    const description = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!description) {
      return applyTo(
        NextResponse.json({ error: "Could not read that photo. Try another one." }, { status: 500 })
      );
    }

    return applyTo(NextResponse.json({ description }));
  } catch (err) {
    console.error("[analyze-photo] vision request failed:", err);
    return applyTo(
      NextResponse.json(
        { error: "Could not analyse the photo. Try again." },
        { status: 500 }
      )
    );
  }
}
