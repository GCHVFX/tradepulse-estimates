/**
 * Deleting an estimate, ownership first.
 *
 * `DELETE /api/estimates?id=` used to remove an estimate's Storage photos,
 * photo rows, change log and payment reminders through the service role,
 * scoped only by the id in the query string, and check ownership only on the
 * final parent delete. Any signed-in user holding another business's estimate
 * id (every share link carries one) could wipe that estimate's children, and
 * the route still answered success because the parent delete matched nothing.
 *
 * Here nothing is touched until the estimate is found under the caller's own
 * business. Every child deletion then uses the id of that authorized estimate,
 * never the raw input, so a Storage path can only ever come from a photo row
 * that belongs to it.
 *
 * Pure orchestration over injected dependencies, so the ordering can be tested
 * without a database. Child-deletion failures stay non-fatal, exactly as the
 * route has always treated them; only a failed parent delete is an error.
 */

export interface EstimateDeletionDependencies {
  /** The estimate, only if it belongs to this business. */
  findOwnedEstimate(estimateId: string, businessId: string): Promise<{ id: string } | null>;
  listPhotoStoragePaths(estimateId: string): Promise<string[]>;
  removePhotoObjects(storagePaths: string[]): Promise<void>;
  deletePhotoRows(estimateId: string): Promise<void>;
  deleteEstimateChanges(estimateId: string): Promise<void>;
  deletePaymentReminders(estimateId: string): Promise<void>;
  /** Returns an error message, or null on success. */
  deleteEstimate(estimateId: string, businessId: string): Promise<string | null>;
}

export type EstimateDeletionResult =
  | { ok: true }
  | { ok: false; status: 404 | 500; error: string };

export const ESTIMATE_NOT_FOUND_OR_DENIED = "Estimate not found or access denied";

export async function deleteOwnedEstimate(
  estimateId: string,
  businessId: string,
  deps: EstimateDeletionDependencies
): Promise<EstimateDeletionResult> {
  let owned: { id: string } | null;
  try {
    owned = await deps.findOwnedEstimate(estimateId, businessId);
  } catch (error) {
    return { ok: false, status: 500, error: error instanceof Error ? error.message : "Could not load estimate" };
  }

  // The whole fix: refuse before any child is touched.
  if (!owned) {
    return { ok: false, status: 404, error: ESTIMATE_NOT_FOUND_OR_DENIED };
  }

  // tpe_estimate_changes, tpe_estimate_photos and tpe_payment_reminders all
  // reference tpe_estimates with delete_rule NO ACTION (not CASCADE), so the
  // parent delete fails with a foreign key violation while any of them still
  // has a row for this estimate. Remove those children first.
  const storagePaths = await deps.listPhotoStoragePaths(owned.id);
  if (storagePaths.length > 0) {
    await deps.removePhotoObjects(storagePaths);
    await deps.deletePhotoRows(owned.id);
  }

  await deps.deleteEstimateChanges(owned.id);
  await deps.deletePaymentReminders(owned.id);

  const deleteError = await deps.deleteEstimate(owned.id, businessId);
  if (deleteError) {
    return { ok: false, status: 500, error: deleteError };
  }

  return { ok: true };
}
