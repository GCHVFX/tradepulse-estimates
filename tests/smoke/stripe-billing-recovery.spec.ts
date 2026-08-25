import { expect, test } from "@playwright/test";
import {
  recoverStoredStripeBillingReferences,
  type StripeBillingReferenceClient,
  type StripeBillingReferenceStore,
} from "../../lib/stripe-billing-recovery";

function createStore(events: string[]): StripeBillingReferenceStore {
  return {
    async clearCustomerAndSubscription() {
      events.push("clear-customer-and-subscription");
    },
    async clearSubscription() {
      events.push("clear-subscription");
    },
  };
}

test("clears both stale references before a fresh Checkout customer can be created", async () => {
  const events: string[] = [];
  const stripe: StripeBillingReferenceClient = {
    customers: {
      async retrieve(customerId) {
        events.push(`customer:${customerId}`);
        throw { code: "resource_missing" };
      },
    },
    subscriptions: {
      async retrieve() {
        throw new Error("A missing customer must stop before subscription reuse.");
      },
    },
  };

  const result = await recoverStoredStripeBillingReferences(
    stripe,
    { customerId: "cus-stale", subscriptionId: "sub-stale" },
    createStore(events)
  );

  expect(result).toEqual({ customerId: null, previousTrialSubscriptionId: undefined, subscriptionLookupError: null });
  expect(events).toEqual(["customer:cus-stale", "clear-customer-and-subscription"]);
});

test("keeps a valid customer and clears only a missing subscription", async () => {
  const events: string[] = [];
  const stripe: StripeBillingReferenceClient = {
    customers: {
      async retrieve(customerId) {
        events.push(`customer:${customerId}`);
        return {};
      },
    },
    subscriptions: {
      async retrieve(subscriptionId) {
        events.push(`subscription:${subscriptionId}`);
        throw { statusCode: 404 };
      },
    },
  };

  const result = await recoverStoredStripeBillingReferences(
    stripe,
    { customerId: "cus-valid", subscriptionId: "sub-stale" },
    createStore(events)
  );

  expect(result).toEqual({ customerId: "cus-valid", previousTrialSubscriptionId: undefined, subscriptionLookupError: null });
  expect(events).toEqual(["customer:cus-valid", "subscription:sub-stale", "clear-subscription"]);
});

test("keeps valid trial references for the existing Checkout metadata", async () => {
  const events: string[] = [];
  const stripe: StripeBillingReferenceClient = {
    customers: {
      async retrieve() {
        return {};
      },
    },
    subscriptions: {
      async retrieve() {
        return { status: "trialing" };
      },
    },
  };

  const result = await recoverStoredStripeBillingReferences(
    stripe,
    { customerId: "cus-valid", subscriptionId: "sub-trial" },
    createStore(events)
  );

  expect(result).toEqual({ customerId: "cus-valid", previousTrialSubscriptionId: "sub-trial", subscriptionLookupError: null });
  expect(events).toEqual([]);
});

test("a deleted Stripe customer is treated as missing, not as a valid reference", async () => {
  // Stripe keeps deleted customers retrievable so their history stays
  // inspectable, and then rejects every operation against them. Catching only
  // the error case would let a dead customer through and fail later, at
  // Checkout, instead of recreating it here.
  const events: string[] = [];
  const stripe: StripeBillingReferenceClient = {
    customers: {
      async retrieve(customerId) {
        events.push(`customer:${customerId}`);
        return { id: customerId, object: "customer", deleted: true };
      },
    },
    subscriptions: {
      async retrieve() {
        throw new Error("A deleted customer must stop before subscription reuse.");
      },
    },
  };

  const result = await recoverStoredStripeBillingReferences(
    stripe,
    { customerId: "cus-deleted", subscriptionId: "sub-stale" },
    createStore(events)
  );

  expect(result).toEqual({ customerId: null, previousTrialSubscriptionId: undefined, subscriptionLookupError: null });
  expect(events).toEqual(["customer:cus-deleted", "clear-customer-and-subscription"]);
});

test("a live customer carrying deleted:false is still reusable", async () => {
  const events: string[] = [];
  const stripe: StripeBillingReferenceClient = {
    customers: {
      async retrieve(customerId) {
        events.push(`customer:${customerId}`);
        return { id: customerId, object: "customer", deleted: false };
      },
    },
    subscriptions: {
      async retrieve() {
        return { status: "trialing" };
      },
    },
  };

  const result = await recoverStoredStripeBillingReferences(
    stripe,
    { customerId: "cus-valid", subscriptionId: "sub-trial" },
    createStore(events)
  );

  expect(result).toEqual({
    customerId: "cus-valid",
    previousTrialSubscriptionId: "sub-trial",
    subscriptionLookupError: null,
  });
  expect(events).toEqual(["customer:cus-valid"]);
});
