import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type PhotoUploadReservationResult =
  | { reservationId: string; reason: null }
  | { reservationId: null; reason: "photo_limit" | "storage_limit" };

export async function reservePhotoUpload(
  supabaseAdmin: SupabaseClient<Database>,
  input: {
    businessId: string;
    estimateId: string;
    expectedFileCount: number;
    expectedByteCount: number;
  }
): Promise<PhotoUploadReservationResult> {
  const { data, error } = await supabaseAdmin.rpc("reserve_estimate_photo_upload", {
    p_business_id: input.businessId,
    p_estimate_id: input.estimateId,
    p_expected_file_count: input.expectedFileCount,
    p_expected_byte_count: input.expectedByteCount,
  });

  if (error) throw new Error("Unable to reserve photo upload capacity");

  const reservation = data?.[0];
  if (!reservation) throw new Error("Photo upload reservation returned no result");
  if (reservation.reserved && reservation.reservation_id) {
    return { reservationId: reservation.reservation_id, reason: null };
  }
  if (reservation.reason === "photo_limit" || reservation.reason === "storage_limit") {
    return { reservationId: null, reason: reservation.reason };
  }
  throw new Error("Photo upload reservation returned an invalid result");
}

export async function releasePhotoUploadReservation(
  supabaseAdmin: SupabaseClient<Database>,
  reservationId: string
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_estimate_photo_upload_reservation", {
    p_reservation_id: reservationId,
  });
  if (error) {
    console.error("[photo-upload-reservations] unable to release reservation:", error.message);
  }
}
