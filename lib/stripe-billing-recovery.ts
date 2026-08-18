export type StoredStripeBillingReferences = {
  customerId: string | null;
  subscriptionId: string | null;
};

type RetrievedSubscription = {
  status: string;
};

export interface StripeBillingReferenceClient {
  customers: {
    retrieve(customerId: string): Promise<unknown>;
  };
  subscriptions: {
    retrieve(subscriptionId: string): Promise<RetrievedSubscription>;
  };
}

export interface StripeBillingReferenceStore {
  clearCustomerAndSubscription(): Promise<void>;
  clearSubscription(): Promise<void>;
}

export type RecoveredStripeBillingReferences = {
  customerId: string | null;
  previousTrialSubscriptionId: string | undefined;
  subscriptionLookupError: unknown | null;
};

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
 * Validates saved Stripe references before reusing them for a new upgrade.
 * Missing objects are stale state, not a reason to leave the owner unable to
 * upgrade. Other Stripe errors are preserved for the caller to report.
 */
export async function recoverStoredStripeBillingReferences(
  stripe: StripeBillingReferenceClient,
  stored: StoredStripeBillingReferences,
  store: StripeBillingReferenceStore
): Promise<RecoveredStripeBillingReferences> {
  let customerId = stored.customerId;

  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
    } catch (error) {
      if (!isMissingStripeObject(error)) throw error;
      await store.clearCustomerAndSubscription();
      return { customerId: null, previousTrialSubscriptionId: undefined, subscriptionLookupError: null };
    }
  }

  if (!stored.subscriptionId) {
    return { customerId, previousTrialSubscriptionId: undefined, subscriptionLookupError: null };
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(stored.subscriptionId);
    return {
      customerId,
      previousTrialSubscriptionId: subscription.status === "trialing" ? stored.subscriptionId : undefined,
      subscriptionLookupError: null,
    };
  } catch (error) {
    if (isMissingStripeObject(error)) {
      await store.clearSubscription();
      return { customerId, previousTrialSubscriptionId: undefined, subscriptionLookupError: null };
    }

    return { customerId, previousTrialSubscriptionId: undefined, subscriptionLookupError: error };
  }
}
