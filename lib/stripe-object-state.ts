/**
 * Shared predicates for deciding whether a stored Stripe reference is still
 * usable.
 *
 * Stripe reports a genuinely absent object by raising an error, so a caller
 * that only inspects the catch block looks correct. A *deleted* customer is
 * different: it still resolves successfully, carrying `deleted: true` on the
 * body, and then rejects every subsequent operation performed against it.
 * Code that treats "retrieve resolved" as "reference is good" therefore
 * reuses a dead customer and fails later, at the point of use, with an
 * opaque message instead of recreating the customer.
 *
 * Both cases mean the same thing here: the stored reference cannot be reused.
 */

export function isMissingStripeObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  return (
    candidate.code === "resource_missing" ||
    candidate.statusCode === 404 ||
    (typeof candidate.message === "string" && /no such (customer|subscription)/i.test(candidate.message))
  );
}

/**
 * True when Stripe returned the object but it has been deleted. Deleted
 * customers stay retrievable so their history can be inspected, which is why
 * this has to be checked on the resolved value rather than in a catch block.
 */
export function isDeletedStripeObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { deleted?: unknown }).deleted === true;
}
