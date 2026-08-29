import { test, expect } from "@playwright/test";
import { hasProPaymentsAccess } from "../../lib/auth";

/**
 * Pure unit coverage for the Pro Payments entitlement rule, the single
 * predicate that now gates all three Payments surfaces:
 *
 *   - PATCH /api/estimates/[id]/invoice
 *   - PATCH /api/estimates/[id]/mark-paid
 *   - GET  /api/cron/payment-reminders  (which businesses get reminders sent)
 *
 * This file touches no browser, no network, and no database. It exists as the
 * fast, always-runnable proof of the rule itself. The API-level proof that the
 * routes actually apply it lives in payments-pro-enforced.spec.ts, which needs
 * live services.
 *
 * The reminder-selection cases matter most: the cron builds its business map
 * with this predicate, so "excluded here" means "no SMS or email is sent to
 * that business's customers".
 */

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

// SubscriptionAccessBusiness requires all four keys (nullable), so that a
// route whose `.select()` omits a column fails to compile instead of silently
// denying a paying customer -- see lib/subscription-access.ts. Fixtures state
// every field explicitly rather than defaulting through a helper, because in
// several cases below `stripe_subscription_id: null` is load-bearing: a live
// id would resolve a Pro trial to "active" and invert the assertion.
const NO_SUBSCRIPTION = null;

test("Starter is never entitled, whatever the subscription status", () => {
  for (const subscription_status of ["active", "trial", "complimentary", "past_due", "cancelled"]) {
    expect(
      hasProPaymentsAccess({
        plan: "starter",
        subscription_status,
        trial_ends_at: FUTURE,
        stripe_subscription_id: NO_SUBSCRIPTION,
      }),
      `starter + ${subscription_status} must be refused`
    ).toBe(false);
  }
});

test("Pro with a live subscription is entitled", () => {
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "active",
      trial_ends_at: null,
      stripe_subscription_id: NO_SUBSCRIPTION,
    })
  ).toBe(true);
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "complimentary",
      trial_ends_at: null,
      stripe_subscription_id: NO_SUBSCRIPTION,
    })
  ).toBe(true);
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "trial",
      trial_ends_at: FUTURE,
      stripe_subscription_id: NO_SUBSCRIPTION,
    })
  ).toBe(true);
});

test("Pro with a dead subscription is not entitled", () => {
  // The reason this half of the rule exists: reminders go to the business's
  // customers, so a lapsed account must stop generating them.
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "trial",
      trial_ends_at: PAST,
      stripe_subscription_id: NO_SUBSCRIPTION,
    }),
    "expired trial"
  ).toBe(false);
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "trial",
      trial_ends_at: null,
      stripe_subscription_id: NO_SUBSCRIPTION,
    }),
    "trial with no end date"
  ).toBe(false);
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "cancelled",
      trial_ends_at: null,
      stripe_subscription_id: NO_SUBSCRIPTION,
    }),
    "cancelled"
  ).toBe(false);
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: "past_due",
      trial_ends_at: null,
      stripe_subscription_id: NO_SUBSCRIPTION,
    }),
    "past due"
  ).toBe(false);
});

test("missing or unknown business data is refused, never defaulted to allowed", () => {
  expect(hasProPaymentsAccess(null)).toBe(false);
  expect(hasProPaymentsAccess(undefined)).toBe(false);
  expect(
    hasProPaymentsAccess({
      plan: null,
      subscription_status: null,
      trial_ends_at: null,
      stripe_subscription_id: null,
    }),
    "every field null"
  ).toBe(false);
  expect(
    hasProPaymentsAccess({
      plan: "pro",
      subscription_status: null,
      trial_ends_at: null,
      stripe_subscription_id: null,
    }),
    "pro with no subscription status"
  ).toBe(false);
});

test("trial expiry is evaluated against the supplied clock", () => {
  const business = {
    plan: "pro",
    subscription_status: "trial",
    trial_ends_at: "2026-07-30T12:00:00.000Z",
    stripe_subscription_id: NO_SUBSCRIPTION,
  };
  expect(hasProPaymentsAccess(business, new Date("2026-07-30T11:59:00.000Z")), "before expiry").toBe(true);
  expect(hasProPaymentsAccess(business, new Date("2026-07-30T12:01:00.000Z")), "after expiry").toBe(false);
});

test("reminder selection: the cron's business filter keeps only entitled businesses", () => {
  // Mirrors exactly what app/api/cron/payment-reminders/route.ts does when it
  // builds businessMap. Any business missing from the result is skipped by the
  // loop and receives no reminder.
  const businesses = [
    { id: "pro-active", plan: "pro", subscription_status: "active", trial_ends_at: null, stripe_subscription_id: NO_SUBSCRIPTION },
    { id: "pro-trial-live", plan: "pro", subscription_status: "trial", trial_ends_at: FUTURE, stripe_subscription_id: NO_SUBSCRIPTION },
    { id: "pro-trial-dead", plan: "pro", subscription_status: "trial", trial_ends_at: PAST, stripe_subscription_id: NO_SUBSCRIPTION },
    { id: "pro-cancelled", plan: "pro", subscription_status: "cancelled", trial_ends_at: null, stripe_subscription_id: NO_SUBSCRIPTION },
    { id: "starter-active", plan: "starter", subscription_status: "active", trial_ends_at: null, stripe_subscription_id: NO_SUBSCRIPTION },
  ];

  const eligible = businesses.filter((b) => hasProPaymentsAccess(b)).map((b) => b.id);

  expect(eligible).toEqual(["pro-active", "pro-trial-live"]);
  expect(eligible).not.toContain("starter-active");
  expect(eligible).not.toContain("pro-trial-dead");
  expect(eligible).not.toContain("pro-cancelled");
});
