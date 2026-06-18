export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import { validateContentType } from "@/lib/api-utils";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const client = new Anthropic();

const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const MAX_PHOTOS = 5;

// ~6MB of base64, comfortably under the Anthropic 5MB decoded image limit
const MAX_BASE64_LENGTH = 7_000_000;

interface PhotoInput {
  base64: string;
  mediaType: AllowedMediaType;
  note: string;
}

export async function POST(request: NextRequest) {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("plan")
    .eq("owner_user_id", user.id)
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

  const { photos } = body as { photos?: unknown };

  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_PHOTOS) {
    return applyTo(
      NextResponse.json(
        { error: `photos must be an array of 1 to ${MAX_PHOTOS} photos` },
        { status: 400 }
      )
    );
  }

  const validatedPhotos: PhotoInput[] = [];
  for (const item of photos) {
    if (typeof item !== "object" || item === null) {
      return applyTo(NextResponse.json({ error: "Invalid photo entry" }, { status: 400 }));
    }
    const { base64, mediaType, note } = item as {
      base64?: unknown;
      mediaType?: unknown;
      note?: unknown;
    };
    if (typeof base64 !== "string" || !base64.trim()) {
      return applyTo(
        NextResponse.json({ error: "Each photo needs image data" }, { status: 400 })
      );
    }
    if (base64.length > MAX_BASE64_LENGTH) {
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
    validatedPhotos.push({
      base64,
      mediaType: mediaType as AllowedMediaType,
      note: typeof note === "string" ? note : "",
    });
  }

  try {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const photo of validatedPhotos) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: photo.mediaType, data: photo.base64 },
      });
      if (photo.note.trim()) {
        content.push({
          type: "text",
          text: `Contractor note for this photo: ${photo.note.trim()}`,
        });
      }
    }
    content.push({
      type: "text",
      text: `Analyse all ${validatedPhotos.length} photo(s) above and produce one consolidated plain-English job description covering all visible work. Write it the way a contractor would describe it to get a quote -- specific, direct, no fluff. Include what needs to be fixed or installed, visible damage or scope, approximate size or quantity where visible. Incorporate any contractor notes as additional context. Flag anything unclear that should be verified in person. Keep it under 250 words. Do not generate prices. Do not write an estimate. Just describe the work. Canadian English spelling.`,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    });

    const description = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!description) {
      return applyTo(
        NextResponse.json({ error: "Could not read those photos. Try again." }, { status: 500 })
      );
    }

    return applyTo(NextResponse.json({ description }));
  } catch (err) {
    console.error("[analyze-photo] vision request failed:", err);
    return applyTo(
      NextResponse.json(
        { error: "Could not analyse the photos. Try again." },
        { status: 500 }
      )
    );
  }
}
