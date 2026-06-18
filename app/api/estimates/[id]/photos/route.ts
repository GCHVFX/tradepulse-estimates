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

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, plan")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business || business.plan !== "pro") {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
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

    const filename = `${crypto.randomUUID()}.jpg`;
    const storagePath = `${user.id}/${id}/${filename}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("tpe-estimate-photos")
      .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      console.error("[estimate-photos] upload failed:", uploadError.message);
      return applyTo(NextResponse.json({ error: "Failed to upload photo. Please try again." }, { status: 500 }));
    }

    // Insert record into tpe_estimate_photos table
    const { error: insertError } = await supabaseAdmin
      .from("tpe_estimate_photos")
      .insert({
        estimate_id: id,
        storage_path: storagePath,
        original_filename: filename,
        mime_type: "image/jpeg",
        file_size: buffer.byteLength,
      });

    if (insertError) {
      console.error("[estimate-photos] DB insert failed:", insertError.message);
      return applyTo(NextResponse.json({ error: "Failed to save photo record. Please try again." }, { status: 500 }));
    }

    // Generate a signed URL for the photo
    const { data: signedUrlData } = await supabaseAdmin.storage
      .from("tpe-estimate-photos")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

    if (signedUrlData?.signedUrl) {
      photoUrls.push(signedUrlData.signedUrl);
    }
  }

  return applyTo(NextResponse.json({ photoUrls }));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await params;

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, plan")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business || business.plan !== "pro") {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  let body: { storage_path?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const storagePath = typeof body.storage_path === "string" ? body.storage_path : null;
  if (!storagePath) {
    return applyTo(NextResponse.json({ error: "No photo storage_path provided" }, { status: 400 }));
  }

  // Verify the photo belongs to this estimate
  const { data: photoRecord } = await supabaseAdmin
    .from("tpe_estimate_photos")
    .select("id, storage_path")
    .eq("estimate_id", id)
    .eq("storage_path", storagePath)
    .maybeSingle();

  if (!photoRecord) {
    return applyTo(NextResponse.json({ error: "Photo not found on this estimate" }, { status: 404 }));
  }

  // Remove from storage
  const { error: removeError } = await supabaseAdmin.storage
    .from("tpe-estimate-photos")
    .remove([storagePath]);
  if (removeError) {
    console.error("[estimate-photos] storage remove failed:", removeError.message);
  }

  // Remove from tpe_estimate_photos table
  const { error: deleteError } = await supabaseAdmin
    .from("tpe_estimate_photos")
    .delete()
    .eq("id", photoRecord.id);

  if (deleteError) {
    return applyTo(NextResponse.json({ error: "Failed to remove photo record. Please try again." }, { status: 500 }));
  }

  return applyTo(NextResponse.json({ success: true }));
}
