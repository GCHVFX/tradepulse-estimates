// The one rule for "has this estimate been put in front of a customer".
//
// Sending by SMS or email sets sent_at. Copy link sets copied_at and moves the
// status to 'sent' without touching sent_at. Marking a job done moves the
// status to 'done'. Any one of these means the customer may already hold the
// estimate, so anything that decides delivered-versus-undelivered behaviour
// uses this predicate instead of checking one of those fields on its own.

import { classifyEstimate, type EstimateClassificationInput } from "./estimate-classification";

export interface EstimateDeliveryState {
  sent_at: string | null | undefined;
  copied_at: string | null | undefined;
  status: string | null | undefined;
}

export function isDelivered(estimate: EstimateDeliveryState): boolean {
  return (
    (estimate.sent_at ?? null) !== null ||
    (estimate.copied_at ?? null) !== null ||
    estimate.status === "sent" ||
    estimate.status === "done"
  );
}

/** A patch to the two delivery-relevant fields a caller can actually write. */
export interface EstimateDeliveryPatch {
  status?: string | null;
  copied_at?: string | null;
}

/**
 * `existing` with `patch` applied to `status` and `copied_at` only. A field
 * absent from `patch` keeps its existing value. `sent_at` is never
 * patchable through this shape -- no route that accepts a delivery patch
 * lets a caller write it (see PATCH /api/estimates, which has no `sent_at`
 * field in its request body at all).
 */
function applyDeliveryPatch(
  existing: EstimateDeliveryState,
  patch: EstimateDeliveryPatch
): EstimateDeliveryState {
  return {
    sent_at: existing.sent_at,
    copied_at: "copied_at" in patch ? patch.copied_at : existing.copied_at,
    status: "status" in patch ? patch.status : existing.status,
  };
}

/**
 * Whether a proposed patch to `status` and/or `copied_at` would move an
 * estimate from undelivered to delivered. Built from isDelivered() itself --
 * applying the patch to the existing state and re-running the one shared
 * predicate -- rather than hand-picking which values count as "first
 * delivery". `status: "sent"`, `status: "done"` and a first `copied_at` all
 * have to count: a caller that only checked for `status === "sent"` would
 * let a PATCH move a still-incomplete estimate straight to `status: "done"`
 * and never run the completeness gate at all.
 *
 * Always false once already delivered: this answers "does this patch newly
 * deliver it", not "is the result delivered".
 */
export function wouldNewlyDeliver(existing: EstimateDeliveryState, patch: EstimateDeliveryPatch): boolean {
  if (isDelivered(existing)) return false;
  return isDelivered(applyDeliveryPatch(existing, patch));
}

/**
 * The mirror of wouldNewlyDeliver(): whether a proposed patch would move an
 * *already delivered* estimate back to undelivered. `status` is deliberately
 * never locked once delivered -- sent -> done has to stay possible -- but
 * that same freedom would let a patch move `status` away from "sent"/"done"
 * entirely while `sent_at` and `copied_at` stay null, flipping isDelivered()
 * back to false. That would silently reopen every other route that gates on
 * isDelivered() for this same estimate -- the pricing route, the photo
 * routes, regenerate -- to a two-call bypass (undeliver via this patch, then
 * mutate through the other route). Checked with the same shared predicate,
 * not an enumeration of which status values still count as delivered.
 *
 * Always false if the estimate was not already delivered: this answers
 * "does this patch undo delivery", not "is the result undelivered".
 */
export function wouldNewlyUndeliver(existing: EstimateDeliveryState, patch: EstimateDeliveryPatch): boolean {
  if (!isDelivered(existing)) return false;
  return !isDelivered(applyDeliveryPatch(existing, patch));
}

/**
 * Whether an estimate is a delivered contractor_pricing estimate -- the
 * exact condition that locks its customer-visible document
 * (specs/contractor-owned-pricing.md section 12). Legacy and unpriced
 * inbound-quote estimates are never locked by this predicate, regardless of
 * delivery state. Shared by the photo routes and the send routes so the
 * lock decision cannot drift between them.
 */
export function isDeliveredContractorPricing(
  estimate: EstimateDeliveryState & EstimateClassificationInput
): boolean {
  return classifyEstimate(estimate) === "contractor_pricing" && isDelivered(estimate);
}
