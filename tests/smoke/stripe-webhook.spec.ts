import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import {
  createStripeWebhookHandler,
  SUPPORTED_STRIPE_WEBHOOK_EVENTS,
  toBusinessSubscriptionStatus,
  toWebhookPlan,
  type StripeWebhookStore,
} from "../../lib/stripe-webhook";

const WEBHOOK_SECRET = "whsec_unit_test_only";
const stripe = new Stripe("sk_test_unit_test_only", {
  apiVersion: "2026-03-25.dahlia",
});

function stripeWithSubscriptions(
  fixtures: Record<string, {
    customerId: string;
    priceIds: string[];
    status?: string;
  }>,
  callbacks?: {
    onRetrieve?: (subscriptionId: string) => void;
    onCancel?: (subscriptionId: string) => void;
  }
): Stripe {
  const client = new Stripe("sk_test_unit_test_only", {
    apiVersion: "2026-03-25.dahlia",
  });

  client.subscriptions.retrieve = async (subscriptionId) => {
    callbacks?.onRetrieve?.(subscriptionId);
    const fixture = fixtures[subscriptionId];
    if (!fixture) throw new Error("Missing test subscription fixture");

    return {
      id: subscriptionId,
      customer: fixture.customerId,
      status: fixture.status ?? "active",
      items: {
        data: fixture.priceIds.map((priceId, index) => ({
          id: `si_test_${index}`,
          price: { id: priceId },
        })),
      },
    } as Stripe.Response<Stripe.Subscription>;
  };
  client.subscriptions.cancel = async (subscriptionId) => {
    callbacks?.onCancel?.(subscriptionId);
    return {
      id: subscriptionId,
      status: "canceled",
    } as Stripe.Response<Stripe.Subscription>;
  };

  return client;
}

const noOpStore: StripeWebhookStore = {
  findBusinessByCustomer: async () => null,
  linkCheckout: async () => false,
  syncSubscription: async () => undefined,
  updateCurrentSubscriptionStatus: async () => undefined,
};

function signedRequest(type: string, object: Record<string, unknown>): Request {
  const payload = JSON.stringify({
    id: `evt_${type.replaceAll(".", "_")}`,
    object: "event",
    api_version: "2026-03-25.dahlia",
    created: 1_754_176_000,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  return new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature },
  });
}

test("invalid Stripe signatures are rejected before dispatch", async () => {
  const handler = createStripeWebhookHandler({
    stripe,
    store: noOpStore,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => undefined,
  });

  const response = await handler(
    new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: JSON.stringify({ id: "evt_invalid", type: "customer.created" }),
      headers: { "stripe-signature": "invalid" },
    })
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Webhook signature verification failed" });
});

test("a missing Stripe signature is rejected", async () => {
  const handler = createStripeWebhookHandler({
    stripe,
    store: noOpStore,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => undefined,
  });

  const response = await handler(new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    body: "{}",
  }));

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "No signature" });
});

test("a missing webhook secret fails safely", async () => {
  const handler = createStripeWebhookHandler({
    stripe,
    store: noOpStore,
    getWebhookSecret: () => undefined,
    getProPriceId: () => undefined,
  });

  const response = await handler(signedRequest("customer.created", { object: "customer" }));

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({ error: "Webhook not configured" });
});

test("valid unknown events are acknowledged without mutation", async () => {
  let mutations = 0;
  const store: StripeWebhookStore = {
    ...noOpStore,
    linkCheckout: async () => { mutations += 1; return true; },
    syncSubscription: async () => { mutations += 1; },
    updateCurrentSubscriptionStatus: async () => { mutations += 1; },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => undefined,
  });

  const response = await handler(signedRequest("customer.created", { object: "customer" }));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ received: true });
  expect(mutations).toBe(0);
});

test("the supported Stripe destination event list is exact", () => {
  expect(SUPPORTED_STRIPE_WEBHOOK_EVENTS).toEqual([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
  ]);
});

test("every Stripe subscription status maps explicitly and unknown values fail closed", () => {
  expect([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "canceled",
    "paused",
  ].map((status) => [status, toBusinessSubscriptionStatus(status)])).toEqual([
    ["active", "active"],
    ["trialing", "trial"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["incomplete", "past_due"],
    ["incomplete_expired", "cancelled"],
    ["canceled", "cancelled"],
    ["paused", "past_due"],
  ]);
  expect(toBusinessSubscriptionStatus("future_status")).toBeNull();
});

test("only one configured Stripe price maps to a TradePulse plan", () => {
  const prices = {
    starterPriceId: "price_starter",
    proPriceId: "price_pro",
  };

  expect(toWebhookPlan(["price_starter"], prices)).toBe("starter");
  expect(toWebhookPlan(["price_pro"], prices)).toBe("pro");
  expect(toWebhookPlan(["price_unknown"], prices)).toBeNull();
  expect(toWebhookPlan([], prices)).toBeNull();
  expect(toWebhookPlan(["price_starter", "price_pro"], prices)).toBeNull();
});

test("checkout completion links only the expected TradePulse owner and subscription", async () => {
  const links: Array<{
    customerId: string;
    ownerUserId: string;
    expectedSubscriptionId: string | null;
    subscriptionId: string;
    plan: "starter" | "pro";
  }> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async (customerId) =>
      customerId === "cus_tradepulse"
        ? { ownerUserId: "user_expected", stripeSubscriptionId: null }
        : null,
    linkCheckout: async (input) => { links.push(input); return true; },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: { user_id: "user_expected", plan: "starter" },
  }));

  expect(response.status).toBe(200);
  expect(links).toEqual([{
    customerId: "cus_tradepulse",
    ownerUserId: "user_expected",
    expectedSubscriptionId: null,
    subscriptionId: "sub_new",
    plan: "starter",
  }]);
});

test("checkout completion ignores missing or cross-business metadata", async () => {
  const links: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: null,
    }),
    linkCheckout: async (input) => { links.push(input); return true; },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => undefined,
  });

  const unsafeObjects = [
    {
      object: "checkout.session",
      customer: "cus_tradepulse",
      subscription: "sub_new",
      metadata: { plan: "starter" },
    },
    {
      object: "checkout.session",
      customer: "cus_tradepulse",
      subscription: "sub_new",
      metadata: { user_id: "user_other", plan: "starter" },
    },
    {
      object: "checkout.session",
      customer: "cus_tradepulse",
      subscription: null,
      metadata: { user_id: "user_expected", plan: "starter" },
    },
    {
      object: "checkout.session",
      customer: "cus_tradepulse",
      subscription: "sub_new",
      metadata: { user_id: "user_expected", plan: "enterprise" },
    },
  ];

  for (const object of unsafeObjects) {
    const response = await handler(signedRequest("checkout.session.completed", object));
    expect(response.status).toBe(200);
  }

  expect(links).toHaveLength(0);
});

test("checkout completion refuses an unrecognized subscription price", async () => {
  const checkoutStripe = new Stripe("sk_test_unit_test_only", {
    apiVersion: "2026-03-25.dahlia",
  });
  checkoutStripe.subscriptions.retrieve = async () => ({
    id: "sub_new",
    customer: "cus_tradepulse",
    items: { data: [{ price: { id: "price_unknown" } }] },
  }) as Stripe.Response<Stripe.Subscription>;
  const links: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: null,
    }),
    linkCheckout: async (input) => { links.push(input); return true; },
  };
  const handler = createStripeWebhookHandler({
    stripe: checkoutStripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: { user_id: "user_expected", plan: "starter" },
  }));

  expect(response.status).toBe(200);
  expect(links).toHaveLength(0);
});

test("checkout completion maps the configured Pro price", async () => {
  const links: Array<Parameters<StripeWebhookStore["linkCheckout"]>[0]> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: null,
    }),
    linkCheckout: async (input) => { links.push(input); return true; },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_new: { customerId: "cus_tradepulse", priceIds: ["price_pro"] },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: { user_id: "user_expected", plan: "pro" },
  }));

  expect(links).toHaveLength(1);
  expect(links[0].plan).toBe("pro");
});

test("checkout completion refuses mismatched Stripe customer or plan relationships", async () => {
  const links: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: null,
    }),
    linkCheckout: async (input) => { links.push(input); return true; },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_wrong_customer: {
        customerId: "cus_other",
        priceIds: ["price_starter"],
      },
      sub_wrong_plan: {
        customerId: "cus_tradepulse",
        priceIds: ["price_pro"],
      },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_wrong_customer",
    metadata: { user_id: "user_expected", plan: "starter" },
  }));
  await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_wrong_plan",
    metadata: { user_id: "user_expected", plan: "starter" },
  }));

  expect(links).toHaveLength(0);
});

test("a stale checkout session cannot overwrite a newer subscription", async () => {
  let retrieves = 0;
  const links: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    linkCheckout: async (input) => { links.push(input); return true; },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_stale: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    }, {
      onRetrieve: () => { retrieves += 1; },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_stale",
    metadata: {
      user_id: "user_expected",
      plan: "starter",
      previous_subscription_id: "sub_previous",
    },
  }));

  expect(retrieves).toBe(0);
  expect(links).toHaveLength(0);
});

test("duplicate checkout delivery repeats only the same idempotent link update", async () => {
  let business = { ownerUserId: "user_expected", stripeSubscriptionId: null as string | null };
  const links: string[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => business,
    linkCheckout: async ({ subscriptionId }) => {
      links.push(subscriptionId);
      business = { ...business, stripeSubscriptionId: subscriptionId };
      return true;
    },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => undefined,
  });
  const object = {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: { user_id: "user_expected", plan: "starter" },
  };

  await handler(signedRequest("checkout.session.completed", object));
  await handler(signedRequest("checkout.session.completed", object));

  expect(links).toEqual(["sub_new", "sub_new"]);
  expect(business.stripeSubscriptionId).toBe("sub_new");
});

test("checkout completion cannot cancel the previous trial when the conditional link matches no row", async () => {
  let previousRetrieveCalls = 0;
  let cancelCalls = 0;
  const checkoutStripe = stripeWithSubscriptions({
    sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    sub_previous: {
      customerId: "cus_tradepulse",
      priceIds: ["price_starter"],
      status: "trialing",
    },
  }, {
    onRetrieve: (subscriptionId) => {
      if (subscriptionId === "sub_previous") previousRetrieveCalls += 1;
    },
    onCancel: () => { cancelCalls += 1; },
  });

  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_previous",
    }),
    linkCheckout: async () => false,
  };
  const handler = createStripeWebhookHandler({
    stripe: checkoutStripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => undefined,
  });

  const response = await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: {
      user_id: "user_expected",
      plan: "starter",
      previous_subscription_id: "sub_previous",
    },
  }));

  expect(response.status).toBe(200);
  expect(previousRetrieveCalls).toBe(0);
  expect(cancelCalls).toBe(0);
});

test("checkout completion cannot cancel a previous trial owned by another Stripe customer", async () => {
  let cancelCalls = 0;
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_previous",
    }),
    linkCheckout: async () => true,
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
      sub_previous: {
        customerId: "cus_other",
        priceIds: ["price_starter"],
        status: "trialing",
      },
    }, {
      onCancel: () => { cancelCalls += 1; },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: {
      user_id: "user_expected",
      plan: "starter",
      previous_subscription_id: "sub_previous",
    },
  }));

  expect(response.status).toBe(200);
  expect(cancelCalls).toBe(0);
});

test("a failed previous-trial cancellation is retried on duplicate Checkout delivery", async () => {
  let business = {
    ownerUserId: "user_expected",
    stripeSubscriptionId: "sub_previous" as string | null,
  };
  let cancelAttempts = 0;
  const checkoutStripe = stripeWithSubscriptions({
    sub_new: { customerId: "cus_tradepulse", priceIds: ["price_starter"] },
    sub_previous: {
      customerId: "cus_tradepulse",
      priceIds: ["price_starter"],
      status: "trialing",
    },
  });
  checkoutStripe.subscriptions.cancel = async (subscriptionId) => {
    cancelAttempts += 1;
    if (cancelAttempts === 1) throw new Error("Synthetic transient cancellation failure");
    return { id: subscriptionId, status: "canceled" } as Stripe.Response<Stripe.Subscription>;
  };
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => business,
    linkCheckout: async ({ subscriptionId }) => {
      business = { ...business, stripeSubscriptionId: subscriptionId };
      return true;
    },
  };
  const handler = createStripeWebhookHandler({
    stripe: checkoutStripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });
  const checkout = {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new",
    metadata: {
      user_id: "user_expected",
      plan: "starter",
      previous_subscription_id: "sub_previous",
    },
  };

  const first = await handler(signedRequest("checkout.session.completed", checkout));
  const second = await handler(signedRequest("checkout.session.completed", checkout));

  expect(first.status).toBe(500);
  expect(second.status).toBe(200);
  expect(cancelAttempts).toBe(2);
});

test("subscription creation records the subscription, mapped trial status, end date, and plan", async () => {
  const syncs: Array<Parameters<StripeWebhookStore["syncSubscription"]>[0]> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: null,
    }),
    syncSubscription: async (input) => { syncs.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("customer.subscription.created", {
    object: "subscription",
    id: "sub_new",
    customer: "cus_tradepulse",
    status: "trialing",
    trial_end: 1_754_265_600,
    items: { data: [{ price: { id: "price_pro" } }] },
  }));

  expect(response.status).toBe(200);
  expect(syncs).toEqual([{
    customerId: "cus_tradepulse",
    expectedSubscriptionId: null,
    subscriptionId: "sub_new",
    update: {
      stripe_subscription_id: "sub_new",
      subscription_status: "trial",
      trial_ends_at: "2025-08-04T00:00:00.000Z",
      plan: "pro",
    },
  }]);
});

test("subscription updates map every access-relevant Stripe status", async () => {
  const cases = [
    ["active", "active"],
    ["trialing", "trial"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["incomplete", "past_due"],
    ["incomplete_expired", "cancelled"],
    ["canceled", "cancelled"],
    ["paused", "past_due"],
  ] as const;

  for (const [stripeStatus, expectedStatus] of cases) {
    const syncs: Array<Parameters<StripeWebhookStore["syncSubscription"]>[0]> = [];
    const store: StripeWebhookStore = {
      ...noOpStore,
      findBusinessByCustomer: async () => ({
        ownerUserId: "user_expected",
        stripeSubscriptionId: "sub_current",
      }),
      syncSubscription: async (input) => { syncs.push(input); },
    };
    const handler = createStripeWebhookHandler({
      stripe,
      store,
      getWebhookSecret: () => WEBHOOK_SECRET,
      getStarterPriceId: () => "price_starter",
      getProPriceId: () => "price_pro",
    });

    const response = await handler(signedRequest("customer.subscription.updated", {
      object: "subscription",
      id: "sub_current",
      customer: "cus_tradepulse",
      status: stripeStatus,
      trial_end: stripeStatus === "trialing" ? 1_754_265_600 : null,
      items: { data: [{ price: { id: "price_starter" } }] },
    }));

    expect(response.status, stripeStatus).toBe(200);
    expect(syncs, stripeStatus).toHaveLength(1);
    expect(syncs[0].update.subscription_status, stripeStatus).toBe(expectedStatus);
  }
});

test("subscription events refuse unknown, missing, or multiple prices without mutation", async () => {
  const syncs: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    syncSubscription: async (input) => { syncs.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });
  const unsafeItems = [
    [{ price: { id: "price_unknown" } }],
    [],
    [
      { price: { id: "price_starter" } },
      { price: { id: "price_pro" } },
    ],
  ];

  for (const items of unsafeItems) {
    const response = await handler(signedRequest("customer.subscription.updated", {
      object: "subscription",
      id: "sub_current",
      customer: "cus_tradepulse",
      status: "active",
      items: { data: items },
    }));
    expect(response.status).toBe(200);
  }

  expect(syncs).toHaveLength(0);
});

test("an unknown subscription status is acknowledged without mutation", async () => {
  const syncs: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    syncSubscription: async (input) => { syncs.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("customer.subscription.updated", {
    object: "subscription",
    id: "sub_current",
    customer: "cus_tradepulse",
    status: "future_status",
    items: { data: [{ price: { id: "price_starter" } }] },
  }));

  expect(response.status).toBe(200);
  expect(syncs).toHaveLength(0);
});

test("a stale subscription event cannot replace a different current subscription", async () => {
  const syncs: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    syncSubscription: async (input) => { syncs.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("customer.subscription.updated", {
    object: "subscription",
    id: "sub_stale",
    customer: "cus_tradepulse",
    status: "past_due",
    items: { data: [{ price: { id: "price_starter" } }] },
  }));

  expect(response.status).toBe(200);
  expect(syncs).toHaveLength(0);
});

test("subscription deletion cancels only the matching current subscription", async () => {
  const updates: Array<Parameters<StripeWebhookStore["updateCurrentSubscriptionStatus"]>[0]> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    updateCurrentSubscriptionStatus: async (input) => { updates.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => undefined,
  });

  const response = await handler(signedRequest("customer.subscription.deleted", {
    object: "subscription",
    id: "sub_current",
    customer: "cus_tradepulse",
    status: "canceled",
  }));

  expect(response.status).toBe(200);
  expect(updates).toEqual([{
    customerId: "cus_tradepulse",
    subscriptionId: "sub_current",
    status: "cancelled",
  }]);
});

test("a paid subscription invoice restores active access for the matching subscription", async () => {
  const updates: Array<Parameters<StripeWebhookStore["updateCurrentSubscriptionStatus"]>[0]> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    updateCurrentSubscriptionStatus: async (input) => { updates.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_current: {
        customerId: "cus_tradepulse",
        priceIds: ["price_starter"],
        status: "active",
      },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => undefined,
  });

  const response = await handler(signedRequest("invoice.payment_succeeded", {
    object: "invoice",
    customer: "cus_tradepulse",
    amount_paid: 3_900,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_current" },
    },
  }));

  expect(response.status).toBe(200);
  expect(updates).toEqual([{
    customerId: "cus_tradepulse",
    subscriptionId: "sub_current",
    status: "active",
  }]);
});

test("paid invoices cannot reactivate terminal or unknown subscription states", async () => {
  const updates: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    updateCurrentSubscriptionStatus: async (input) => { updates.push(input); },
  };
  const statuses = ["canceled", "incomplete_expired", "future_status"];

  for (const status of statuses) {
    const handler = createStripeWebhookHandler({
      stripe: stripeWithSubscriptions({
        sub_current: {
          customerId: "cus_tradepulse",
          priceIds: ["price_starter"],
          status,
        },
      }),
      store,
      getWebhookSecret: () => WEBHOOK_SECRET,
      getStarterPriceId: () => "price_starter",
      getProPriceId: () => "price_pro",
    });

    const response = await handler(signedRequest("invoice.payment_succeeded", {
      object: "invoice",
      customer: "cus_tradepulse",
      amount_paid: 3_900,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_current" },
      },
    }));
    expect(response.status, status).toBe(200);
  }

  expect(updates).toHaveLength(0);
});

test("failed invoice delivery marks only the current subscription past due and is repeatable", async () => {
  const updates: Array<Parameters<StripeWebhookStore["updateCurrentSubscriptionStatus"]>[0]> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    updateCurrentSubscriptionStatus: async (input) => { updates.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_current: {
        customerId: "cus_tradepulse",
        priceIds: ["price_starter"],
        status: "past_due",
      },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => undefined,
  });
  const invoice = {
    object: "invoice",
    customer: "cus_tradepulse",
    amount_paid: 0,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_current" },
    },
  };

  await handler(signedRequest("invoice.payment_failed", invoice));
  await handler(signedRequest("invoice.payment_failed", invoice));

  expect(updates).toEqual([
    { customerId: "cus_tradepulse", subscriptionId: "sub_current", status: "past_due" },
    { customerId: "cus_tradepulse", subscriptionId: "sub_current", status: "past_due" },
  ]);
});

test("invoice events with missing or mismatched subscription context cannot change access", async () => {
  const updates: unknown[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    updateCurrentSubscriptionStatus: async (input) => { updates.push(input); },
  };
  const handler = createStripeWebhookHandler({
    stripe,
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getProPriceId: () => undefined,
  });
  const unsafeInvoices = [
    {
      object: "invoice",
      customer: "cus_tradepulse",
      amount_paid: 3_900,
      parent: null,
    },
    {
      object: "invoice",
      customer: "cus_tradepulse",
      amount_paid: 3_900,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_other" },
      },
    },
    {
      object: "invoice",
      customer: "cus_tradepulse",
      amount_paid: 0,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_current" },
      },
    },
  ];

  await handler(signedRequest("invoice.payment_failed", unsafeInvoices[0]));
  await handler(signedRequest("invoice.payment_failed", unsafeInvoices[1]));
  await handler(signedRequest("invoice.payment_succeeded", unsafeInvoices[2]));

  expect(updates).toHaveLength(0);
});

test("duplicate subscription updates and invoice success remain idempotent state assignments", async () => {
  const syncedStatuses: unknown[] = [];
  const accessStatuses: string[] = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_current",
    }),
    syncSubscription: async ({ update }) => {
      syncedStatuses.push(update.subscription_status);
    },
    updateCurrentSubscriptionStatus: async ({ status }) => {
      accessStatuses.push(status);
    },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscriptions({
      sub_current: {
        customerId: "cus_tradepulse",
        priceIds: ["price_starter"],
        status: "active",
      },
    }),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });
  const subscription = {
    object: "subscription",
    id: "sub_current",
    customer: "cus_tradepulse",
    status: "active",
    items: { data: [{ price: { id: "price_starter" } }] },
  };
  const invoice = {
    object: "invoice",
    customer: "cus_tradepulse",
    amount_paid: 3_900,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_current" },
    },
  };

  await handler(signedRequest("customer.subscription.updated", subscription));
  await handler(signedRequest("customer.subscription.updated", subscription));
  await handler(signedRequest("invoice.payment_succeeded", invoice));
  await handler(signedRequest("invoice.payment_succeeded", invoice));

  expect(syncedStatuses).toEqual(["active", "active"]);
  expect(accessStatuses).toEqual(["active", "active"]);
});
