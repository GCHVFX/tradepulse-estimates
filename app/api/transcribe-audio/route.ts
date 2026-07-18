export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import { validateContentType } from "@/lib/api-utils";
import { ApiError, GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ALLOWED_MIME_TYPES = ["audio/webm", "audio/mp4"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// ~2MB of base64 comfortably covers a 2-minute dictation at typical voice bitrates
const MAX_BASE64_LENGTH = 2_000_000;

const TRANSCRIBE_PROMPT =
  "Transcribe this audio recording of a contractor describing a job. Clean up filler words (um, uh) and false starts, but otherwise keep it in the contractor's own words. Return only the transcription as plain text. No commentary, no formatting, no description of tone. Canadian English spelling.";

// Gemini's own rate limit (429) or a transient server error (5xx) is worth a
// short retry -- everything else (bad request, auth) fails immediately.
const MAX_RETRIES = 3;

function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 429 || err.status >= 500);
}

async function generateWithRetry(params: GenerateContentParameters) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const delayMs = 500 * 2 ** attempt + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("unreachable");
}

export async function POST(request: NextRequest) {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { allowed } = await checkRateLimit(supabaseAdmin, user.id, "transcribe-audio", 20, 3600);
  if (!allowed) {
    return applyTo(
      NextResponse.json({ error: "Too many recordings. Try again in a bit." }, { status: 429 })
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

  const { audioBase64, mimeType } = body as { audioBase64?: unknown; mimeType?: unknown };

  if (typeof audioBase64 !== "string" || !audioBase64.trim()) {
    return applyTo(NextResponse.json({ error: "Recording data is missing" }, { status: 400 }));
  }
  if (audioBase64.length > MAX_BASE64_LENGTH) {
    return applyTo(
      NextResponse.json({ error: "Recording is too long. Try a shorter one." }, { status: 400 })
    );
  }
  if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
    return applyTo(NextResponse.json({ error: "Unsupported audio format" }, { status: 400 }));
  }

  try {
    const response = await generateWithRetry({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
    });

    const transcription = response.text?.trim();

    if (!transcription) {
      return applyTo(
        NextResponse.json({ error: "Could not hear that clearly. Try again." }, { status: 500 })
      );
    }

    return applyTo(NextResponse.json({ transcription }));
  } catch (err) {
    console.error("[transcribe-audio] transcription request failed:", err);
    return applyTo(
      NextResponse.json({ error: "Could not transcribe that recording. Try again." }, { status: 500 })
    );
  }
}
