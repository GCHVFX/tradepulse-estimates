import { isDeletedStripeObject, isMissingStripeObject } from "./stripe-object-state";

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

export { isMissingStripeObject };

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
    let customer: unknown;
    try {
      customer = await stripe.customers.retrieve(customerId);
    } catch (error) {
      if (!isMissingStripeObject(error)) throw error;
      await store.clearCustomerAndSubscription();
      return { customerId: null, previousTrialSubscriptionId: undefined, subscriptionLookupError: null };
    }

    // A deleted customer still resolves here, so this cannot be folded into
    // the catch above. Stripe rejects every later operation against it, so
    // reusing it would fail at Checkout instead of recreating the customer.
    if (isDeletedStripeObject(customer)) {
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
