import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { decodeBase64Image, imageMimeTypeFromBytes } from "@/lib/image-validation";
import {
  releasePhotoUploadReservation,
  reservePhotoUpload,
} from "@/lib/photo-upload-reservations";

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 2 * 1024 * 1024; // 2MB per photo
const MAX_PHOTO_BASE64_LENGTH = 3 * 1024 * 1024;

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

  const decodedPhotos: Buffer[] = [];

  for (const entry of body.photos) {
    const base64 =
      entry && typeof entry === "object" && typeof (entry as { base64?: unknown }).base64 === "string"
        ? (entry as { base64: string }).base64
        : null;
    if (!base64) {
      return applyTo(NextResponse.json({ error: "Each photo must include base64 data" }, { status: 400 }));
    }

    const buffer = decodeBase64Image(base64, MAX_PHOTO_BASE64_LENGTH);
    if (!buffer) {
      return applyTo(NextResponse.json({ error: "Invalid image data" }, { status: 400 }));
    }
    if (buffer.byteLength === 0) {
      return applyTo(NextResponse.json({ error: "Image file is empty" }, { status: 400 }));
    }
    if (buffer.byteLength > MAX_PHOTO_SIZE) {
      return applyTo(NextResponse.json({ error: "Each photo must be under 2MB" }, { status: 400 }));
    }
    if (imageMimeTypeFromBytes(buffer) !== "image/jpeg") {
      return applyTo(NextResponse.json({ error: "Each estimate photo must be a JPEG image" }, { status: 400 }));
    }
    decodedPhotos.push(buffer);
  }

  const incomingBytes = decodedPhotos.reduce((total, photo) => total + photo.byteLength, 0);
  let reservation;
  try {
    reservation = await reservePhotoUpload(supabaseAdmin, {
      businessId: business.id,
      estimateId: estimate.id,
      expectedFileCount: decodedPhotos.length,
      expectedByteCount: incomingBytes,
    });
  } catch (error) {
    console.error("[estimate-photos] unable to reserve upload capacity:", error);
    return applyTo(NextResponse.json({ error: "Unable to reserve photo storage. Please try again." }, { status: 500 }));
  }

  if (!reservation.reservationId) {
    const error = reservation.reason === "photo_limit"
      ? "Your business has reached its photo limit"
      : "Your business has reached its photo storage limit";
    return applyTo(NextResponse.json({ error }, { status: 409 }));
  }

  const photoUrls: string[] = [];
  const uploadedStoragePaths: string[] = [];
  const insertedStoragePaths: string[] = [];

  try {
    for (const buffer of decodedPhotos) {

      const filename = `${crypto.randomUUID()}.jpg`;
      const storagePath = `${user.id}/${id}/${filename}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("tpe-estimate-photos")
        .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

      if (uploadError) {
        console.error("[estimate-photos] upload failed:", uploadError.message);
        throw new Error("PHOTO_UPLOAD_FAILED");
      }
      uploadedStoragePaths.push(storagePath);

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
        throw new Error("PHOTO_RECORD_INSERT_FAILED");
      }
      insertedStoragePaths.push(storagePath);

      const { data: signedUrlData } = await supabaseAdmin.storage
        .from("tpe-estimate-photos")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

      if (signedUrlData?.signedUrl) {
        photoUrls.push(signedUrlData.signedUrl);
      }
    }
  } catch (error) {
    if (insertedStoragePaths.length > 0) {
      const { error: rollbackDbError } = await supabaseAdmin
        .from("tpe_estimate_photos")
        .delete()
        .eq("estimate_id", id)
        .in("storage_path", insertedStoragePaths);
      if (rollbackDbError) console.error("[estimate-photos] record rollback failed:", rollbackDbError.message);
    }
    if (uploadedStoragePaths.length > 0) {
      const { error: rollbackStorageError } = await supabaseAdmin.storage
        .from("tpe-estimate-photos")
        .remove(uploadedStoragePaths);
      if (rollbackStorageError) console.error("[estimate-photos] storage rollback failed:", rollbackStorageError.message);
    }
    console.error("[estimate-photos] upload batch failed:", error);
    return applyTo(NextResponse.json({ error: "Failed to upload photos. Please try again." }, { status: 500 }));
  } finally {
    await releasePhotoUploadReservation(supabaseAdmin, reservation.reservationId);
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
