/**
 * Regression test for a real, confirmed-in-production billing bug: a
 * Starter customer upgraded to Pro through Stripe Checkout, the $59 charge
 * succeeded, Stripe showed the subscription Active -- but tpe_businesses
 * kept subscription_status = "trial" from the original Starter signup, and
 * the profile page showed a paying customer a "Free trial" badge.
 *
 * Root cause (verified against the code, not assumed): handleCheckoutCompleted
 * (checkout.session.completed) never wrote subscription_status at all -- it
 * only linked plan + stripe_subscription_id, relying on a paired
 * customer.subscription.created/updated event to set subscription_status
 * via syncSubscription(). Stripe does not guarantee webhook delivery order.
 * When that paired event arrives BEFORE checkout.session.completed processes,
 * handleSubscriptionChanged's own guard (expectedSubscriptionId must already
 * match) rejects it, since the business row still has the OLD (pre-upgrade)
 * subscription id at that moment. The event is silently dropped -- Stripe
 * still gets a 200, so it is never retried -- and subscription_status is
 * never touched by anything afterward. plan updates via linkCheckout
 * regardless, which is exactly the "plan correct, subscription_status
 * stale" split that was observed.
 *
 * The fix: handleCheckoutCompleted already retrieves the Stripe subscription
 * object (to detect its price/plan) -- it now also maps that subscription's
 * .status via the existing toBusinessSubscriptionStatus() and writes it in
 * the SAME linkCheckout call, so subscription_status can no longer depend on
 * a second, possibly-rejected webhook event.
 */
import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import {
  createStripeWebhookHandler,
  toBusinessSubscriptionStatus,
  type StripeWebhookStore,
} from "../../lib/stripe-webhook";
import { hasProPaymentsAccess } from "../../lib/auth";
import { resolveProfileBadge } from "../../lib/subscription-display";
import { resolveSubscriptionStatus } from "../../lib/subscription-access";

// A stored Stripe subscription id, i.e. this business actually has a
// subscription on record. The Pro-stuck-at-trial correction only applies
// when one is present -- see lib/subscription-access.ts.
const LIVE_SUB = "sub_1U9cU7Q45KFNqa8xBHKwUxEU";

const WEBHOOK_SECRET = "whsec_unit_test_only";
const stripe = new Stripe("sk_test_unit_test_only", { apiVersion: "2026-03-25.dahlia" });

function stripeWithSubscription(status: string): Stripe {
  const client = new Stripe("sk_test_unit_test_only", { apiVersion: "2026-03-25.dahlia" });
  client.subscriptions.retrieve = async (subscriptionId) => ({
    id: subscriptionId,
    customer: "cus_tradepulse",
    status,
    trial_end: null,
    items: { data: [{ id: "si_1", price: { id: "price_pro" } }] },
  }) as Stripe.Response<Stripe.Subscription>;
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
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return new Request("https://tradepulse-estimates.com/api/billing/webhook", {
    method: "POST",
    body: payload,
    headers: { "stripe-signature": signature },
  });
}

test("a checkout.session.completed for an active Pro subscription writes subscription_status 'active', not 'trial'", async () => {
  // Reproduces the exact reported scenario: a business that started as
  // Starter on a trial (stripeSubscriptionId = the old trial subscription)
  // completes a Pro upgrade Checkout for a NEW, already-active subscription.
  const links: Array<{ subscriptionStatus: string | null; plan: string }> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_old_trial",
    }),
    linkCheckout: async (input) => {
      links.push({ subscriptionStatus: input.subscriptionStatus, plan: input.plan });
      return true;
    },
  };
  const handler = createStripeWebhookHandler({
    stripe: stripeWithSubscription("active"),
    store,
    getWebhookSecret: () => WEBHOOK_SECRET,
    getStarterPriceId: () => "price_starter",
    getProPriceId: () => "price_pro",
  });

  const response = await handler(signedRequest("checkout.session.completed", {
    object: "checkout.session",
    customer: "cus_tradepulse",
    subscription: "sub_new_pro",
    metadata: {
      user_id: "user_expected",
      plan: "pro",
      previous_subscription_id: "sub_old_trial",
    },
  }));

  expect(response.status).toBe(200);
  expect(links).toEqual([{ subscriptionStatus: "active", plan: "pro" }]);
});

test("a customer.subscription.updated event for an active Pro subscription writes subscription_status 'active'", async () => {
  const syncs: Array<{ subscription_status: string }> = [];
  const store: StripeWebhookStore = {
    ...noOpStore,
    findBusinessByCustomer: async () => ({
      ownerUserId: "user_expected",
      stripeSubscriptionId: "sub_pro",
    }),
    syncSubscription: async ({ update }) => {
      syncs.push({ subscription_status: update.subscription_status });
    },
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
    id: "sub_pro",
    customer: "cus_tradepulse",
    status: "active",
    items: { data: [{ price: { id: "price_pro" } }] },
  }));

  expect(response.status).toBe(200);
  expect(syncs).toEqual([{ subscription_status: "active" }]);
});

test("every Stripe status Task 2 named has an explicit TradePulse mapping, none invented", () => {
  expect(toBusinessSubscriptionStatus("active")).toBe("active");
  expect(toBusinessSubscriptionStatus("trialing")).toBe("trial");
  expect(toBusinessSubscriptionStatus("past_due")).toBe("past_due");
  expect(toBusinessSubscriptionStatus("canceled")).toBe("cancelled");
  expect(toBusinessSubscriptionStatus("unpaid")).toBe("past_due");
  expect(toBusinessSubscriptionStatus("incomplete")).toBe("past_due");
  // The two remaining real Stripe statuses, also mapped (not left as gaps).
  expect(toBusinessSubscriptionStatus("incomplete_expired")).toBe("cancelled");
  expect(toBusinessSubscriptionStatus("paused")).toBe("past_due");
  // A genuinely unrecognized value returns null (skip the write), never an
  // invented TradePulse status.
  expect(toBusinessSubscriptionStatus("some_future_stripe_status")).toBeNull();
});

test("a Pro business with subscription_status active is never treated as trial-expired, regardless of a stale trial_ends_at", () => {
  // The isActive/isTrialing/hasAccess pattern this exercised in eight
  // separate places now lives once in lib/subscription-access.ts; see
  // subscription-access.spec.ts for the full behaviour matrix. This test
  // stays here as the billing-side regression check.
  const farPastTrialEnd = new Date("2020-01-01T00:00:00.000Z").toISOString();

  expect(
    hasProPaymentsAccess({ plan: "pro", subscription_status: "active", trial_ends_at: farPastTrialEnd })
  ).toBe(true);
  expect(
    hasProPaymentsAccess({ plan: "pro", subscription_status: "active", trial_ends_at: null })
  ).toBe(true);
});

test("resolveSubscriptionStatus corrects a Pro business stuck at trial to active, and leaves every other combination unchanged", () => {
  expect(resolveSubscriptionStatus("trial", "pro", LIVE_SUB)).toBe("active");
  expect(resolveSubscriptionStatus("trial", "starter", LIVE_SUB)).toBe("trial");
  expect(resolveSubscriptionStatus("active", "pro", LIVE_SUB)).toBe("active");
  expect(resolveSubscriptionStatus("past_due", "pro", LIVE_SUB)).toBe("past_due");
  expect(resolveSubscriptionStatus("cancelled", "pro", LIVE_SUB)).toBe("cancelled");
  expect(resolveSubscriptionStatus("complimentary", "pro", LIVE_SUB)).toBe("complimentary");
  expect(resolveSubscriptionStatus(null, "pro", LIVE_SUB)).toBeNull();
  expect(resolveSubscriptionStatus(undefined, undefined, undefined)).toBeUndefined();
});

test("the profile badge renders correctly for trial, active, past_due, and cancelled", () => {
  expect(resolveProfileBadge("trial", "starter", null)).toEqual({ label: "Free trial", colorClass: "amber" });
  expect(resolveProfileBadge("active", "starter", LIVE_SUB)).toEqual({ label: "Subscription active", colorClass: "emerald" });
  expect(resolveProfileBadge("past_due", "pro", LIVE_SUB)).toEqual({ label: "Payment issue", colorClass: "red" });
  expect(resolveProfileBadge("cancelled", "pro", LIVE_SUB)).toEqual({ label: "Subscription cancelled", colorClass: "zinc" });
});

test("a paying (plan pro) subscriber whose stored status is still trial never sees the Free trial badge", () => {
  // The exact production scenario, asserted directly against the badge
  // function's output.
  const badge = resolveProfileBadge("trial", "pro", LIVE_SUB);
  expect(badge).toEqual({ label: "Subscription active", colorClass: "emerald" });
  expect(badge?.label).not.toBe("Free trial");
});

test("a Starter customer genuinely mid-trial still sees Free trial -- the fix is scoped to plan pro only", () => {
  const badge = resolveProfileBadge("trial", "starter", null);
  expect(badge?.label).toBe("Free trial");
});

test("complimentary and unrecognized statuses render sensibly, never a blank badge for a known status", () => {
  expect(resolveProfileBadge("complimentary", "pro", LIVE_SUB)).toEqual({ label: "Complimentary", colorClass: "emerald" });
  expect(resolveProfileBadge("something_unrecognized", "pro", LIVE_SUB)).toBeNull();
  expect(resolveProfileBadge(null, null, null)).toBeNull();
});
