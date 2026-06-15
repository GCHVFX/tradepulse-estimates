import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 2 * 1024 * 1024; // 2MB per photo

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await params;

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id")
    .eq("id", id)
    .eq("business_id", user.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!business || business.plan !== "pro") {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  let body: { photos?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  if (!Array.isArray(body.photos) || body.photos.length === 0) {
    return applyTo(NextResponse.json({ error: "No photos provided" }, { status: 400 }));
  }
  if (body.photos.length > MAX_PHOTOS) {
    return applyTo(NextResponse.json({ error: `Maximum ${MAX_PHOTOS} photos` }, { status: 400 }));
  }

  const photoUrls: string[] = [];

  for (const entry of body.photos) {
    const base64 =
      entry && typeof entry === "object" && typeof (entry as { base64?: unknown }).base64 === "string"
        ? (entry as { base64: string }).base64
        : null;
    if (!base64) {
      return applyTo(NextResponse.json({ error: "Each photo must include base64 data" }, { status: 400 }));
    }

    const raw = base64.includes(",") ? base64.split(",")[1] : base64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, "base64");
    } catch {
      return applyTo(NextResponse.json({ error: "Invalid image data" }, { status: 400 }));
    }
    if (buffer.byteLength === 0) {
      return applyTo(NextResponse.json({ error: "Image file is empty" }, { status: 400 }));
    }
    if (buffer.byteLength > MAX_PHOTO_SIZE) {
      return applyTo(NextResponse.json({ error: "Each photo must be under 2MB" }, { status: 400 }));
    }

    const path = `${user.id}/${id}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("estimate-photos")
      .upload(path, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      console.error("[estimate-photos] upload failed:", uploadError.message);
      return applyTo(NextResponse.json({ error: "Failed to upload photo. Please try again." }, { status: 500 }));
    }

    const { data } = supabaseAdmin.storage.from("estimate-photos").getPublicUrl(path);
    photoUrls.push(data.publicUrl);
  }

  // Save the URLs. include_photos stays at its default (false): photos are
  // saved but hidden until the contractor turns them on from the estimate.
  const { error: updateError } = await supabaseAdmin
    .from("tpe_estimates")
    .update({ photo_urls: photoUrls })
    .eq("id", id)
    .eq("business_id", user.id);

  if (updateError) {
    return applyTo(NextResponse.json({ error: "Photos uploaded but failed to save" }, { status: 500 }));
  }

  return applyTo(NextResponse.json({ photoUrls }));
}
