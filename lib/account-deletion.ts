export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";
export const RECENT_SIGN_IN_MAX_AGE_MS = 15 * 60 * 1000;

export type AccountDeletionBusiness = {
  id: string;
  ownerUserId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  logoUrl: string | null;
};

export type StorageObject = {
  bucket: "logos" | "tpe-estimate-photos";
  path: string;
};

export interface StripeSubscriptionClient {
  subscriptions: {
    retrieve(subscriptionId: string): Promise<{
      customer: string | { id: string };
      status: string;
    }>;
    cancel(subscriptionId: string): Promise<unknown>;
  };
}

export interface AccountDeletionDependencies {
  findOwnedBusiness(userId: string): Promise<AccountDeletionBusiness | null>;
  listStorageObjects(business: AccountDeletionBusiness): Promise<StorageObject[]>;
  removeStorageObjects(objects: StorageObject[]): Promise<void>;
  cancelSubscription(business: AccountDeletionBusiness): Promise<void>;
  beginBusinessDeletion(business: AccountDeletionBusiness): Promise<void>;
  releaseBusinessDeletion(business: AccountDeletionBusiness): Promise<void>;
  deleteBusinessData(business: AccountDeletionBusiness): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  clearSession(): Promise<void>;
}

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export function hasRecentSignIn(lastSignInAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSignInAt) return false;
  const signedInAt = Date.parse(lastSignInAt);
  return Number.isFinite(signedInAt) && signedInAt <= now && now - signedInAt <= RECENT_SIGN_IN_MAX_AGE_MS;
}

function stripeCustomerId(customer: string | { id: string }): string {
  return typeof customer === "string" ? customer : customer.id;
}

function isMissingStripeObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  return (
    candidate.code === "resource_missing" ||
    candidate.statusCode === 404 ||
    (typeof candidate.message === "string" && /no such (customer|subscription)/i.test(candidate.message))
  );
}

/**
 * Cancels only the subscription referenced by this already-owned business.
 * A missing or terminal subscription is safe to retry and deliberately does
 * not affect a stored customer or any unrelated Stripe object.
 */
export async function cancelOwnedStripeSubscription(
  stripe: StripeSubscriptionClient,
  business: AccountDeletionBusiness
): Promise<void> {
  if (!business.stripeSubscriptionId) return;

  if (!business.stripeCustomerId) {
    throw new AccountDeletionError("Stored billing references are incomplete. Account deletion was not started.", 409);
  }

  let subscription: Awaited<ReturnType<StripeSubscriptionClient["subscriptions"]["retrieve"]>>;
  try {
    subscription = await stripe.subscriptions.retrieve(business.stripeSubscriptionId);
  } catch (error) {
    if (isMissingStripeObject(error)) return;
    throw error;
  }

  if (stripeCustomerId(subscription.customer) !== business.stripeCustomerId) {
    throw new AccountDeletionError("Stored billing references do not match. Account deletion was not started.", 409);
  }

  if (["canceled", "incomplete_expired"].includes(subscription.status)) return;

  try {
    await stripe.subscriptions.cancel(business.stripeSubscriptionId);
  } catch (error) {
    if (isMissingStripeObject(error)) return;
    throw error;
  }
}

/**
 * Performs the irreversible work in a strict order. Each dependency is
 * injected so the route stays server-only and the sequence is unit-testable.
 */
export async function deleteAuthenticatedAccount(input: {
  confirmation: unknown;
  userId: string;
  lastSignInAt: string | null | undefined;
  dependencies: AccountDeletionDependencies;
}): Promise<void> {
  if (input.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    throw new AccountDeletionError('Type DELETE exactly to permanently delete your account.', 400);
  }

  if (!hasRecentSignIn(input.lastSignInAt)) {
    throw new AccountDeletionError('For your security, sign out and sign back in before deleting your account.', 403);
  }

  const business = await input.dependencies.findOwnedBusiness(input.userId);

  if (business) {
    if (business.ownerUserId !== input.userId) {
      throw new AccountDeletionError('Business ownership could not be verified.', 403);
    }

    await input.dependencies.beginBusinessDeletion(business);
    try {
      await input.dependencies.cancelSubscription(business);
      const storageObjects = await input.dependencies.listStorageObjects(business);
      await input.dependencies.removeStorageObjects(storageObjects);
      await input.dependencies.deleteBusinessData(business);
    } catch (error) {
      await input.dependencies.releaseBusinessDeletion(business);
      throw error;
    }
  }

  // Auth is intentionally last. If Storage, Stripe, or the database step
  // fails, the person remains signed in and can retry without losing access.
  await input.dependencies.deleteAuthUser(input.userId);
  await input.dependencies.clearSession();
}
