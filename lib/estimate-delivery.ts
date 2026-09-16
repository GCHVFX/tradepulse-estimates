// The one rule for "has this estimate been put in front of a customer".
//
// Sending by SMS or email sets sent_at. Copy link sets copied_at and moves the
// status to 'sent' without touching sent_at. Marking a job done moves the
// status to 'done'. Any one of these means the customer may already hold the
// estimate, so anything that decides delivered-versus-undelivered behaviour
// uses this predicate instead of checking one of those fields on its own.

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
