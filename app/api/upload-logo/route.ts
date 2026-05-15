import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

function getMimeTypeExtension(mimeType: string): string | null {
  const mapping: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return mapping[mimeType] ?? null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll() {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as { data?: string; type?: string };

    if (!body.data || !body.type) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: "Please select a JPG, PNG, or WebP image file." },
        { status: 400 }
      );
    }

    // Get extension from MIME type
    const extension = getMimeTypeExtension(body.type);
    if (!extension) {
      return NextResponse.json(
        { error: "Unsupported image format." },
        { status: 400 }
      );
    }

    // Decode base64
    const base64 = body.data.split(",")[1] ?? body.data;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid image data." }, { status: 400 });
    }

    // Validate file size
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Image must be under 2MB." },
        { status: 400 }
      );
    }

    // Validate file is not empty
    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { error: "Image file is empty." },
        { status: 400 }
      );
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const filename = `logo.${extension}`;
    const path = `${user.id}/${filename}`;

    const { error: uploadError } = await admin.storage
      .from("logos")
      .upload(path, buffer, {
        upsert: true,
        contentType: body.type,
      });

    if (uploadError) {
      console.error("[upload-logo] upload failed:", uploadError.message);
      return NextResponse.json(
        { error: "Failed to upload image. Please try again." },
        { status: 500 }
      );
    }

    const { data } = admin.storage.from("logos").getPublicUrl(path);
    const url = `${data.publicUrl}?t=${Date.now()}`;

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[upload-logo] unhandled error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}