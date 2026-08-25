import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isDeletedStripeObject, isMissingStripeObject } from "../../lib/stripe-object-state";

test("a deleted Stripe object is recognised from the resolved value", () => {
  expect(isDeletedStripeObject({ id: "cus_1", object: "customer", deleted: true })).toBe(true);
  expect(isDeletedStripeObject({ id: "cus_1", object: "customer", deleted: false })).toBe(false);
  expect(isDeletedStripeObject({ id: "cus_1", object: "customer" })).toBe(false);
  expect(isDeletedStripeObject(null)).toBe(false);
  expect(isDeletedStripeObject(undefined)).toBe(false);
  expect(isDeletedStripeObject("deleted")).toBe(false);
  // Only a real boolean true counts, so a truthy string cannot smuggle a
  // deleted customer through as live or vice versa.
  expect(isDeletedStripeObject({ deleted: "true" })).toBe(false);
});

test("missing Stripe objects are still recognised from the thrown error", () => {
  expect(isMissingStripeObject({ code: "resource_missing" })).toBe(true);
  expect(isMissingStripeObject({ statusCode: 404 })).toBe(true);
  expect(isMissingStripeObject(new Error("No such customer: 'cus_1'"))).toBe(true);
  expect(isMissingStripeObject(new Error("No such subscription: 'sub_1'"))).toBe(true);
  expect(isMissingStripeObject(new Error("card_declined"))).toBe(false);
  expect(isMissingStripeObject(null)).toBe(false);
});

test("the Checkout route treats a deleted stored customer as missing", () => {
  // The route needs a running Next request to exercise directly, so this
  // asserts the guard is actually wired rather than re-implementing it.
  const source = readFileSync("app/api/billing/checkout/route.ts", "utf8");

  expect(source).toContain("isDeletedStripeObject");
  expect(source).toContain('from "@/lib/stripe-object-state"');

  const retrieveIndex = source.indexOf("stripe.customers.retrieve");
  const deletedCheckIndex = source.indexOf("isDeletedStripeObject(existingCustomer)");
  const createIndex = source.indexOf("stripe.customers.create");

  expect(retrieveIndex).toBeGreaterThan(-1);
  expect(deletedCheckIndex).toBeGreaterThan(retrieveIndex);
  expect(createIndex).toBeGreaterThan(deletedCheckIndex);
});

test("both provisioning call sites go through the compensating helper", () => {
  for (const path of ["app/api/auth/signup/route.ts", "app/auth/callback/route.ts"]) {
    const source = readFileSync(path, "utf8");
    expect(source, `${path} must provision through the shared helper`).toContain("provisionNewAccount");
    // The old inline sequences deleted the Auth user before touching Stripe,
    // which is what produced unattributable orphans.
    expect(source, `${path} must not delete the Auth user inline`).not.toContain(
      "supabaseAdmin.auth.admin.deleteUser"
    );
    expect(source, `${path} must not call Stripe directly`).not.toContain("stripe.customers.create");
    expect(source, `${path} must not create subscriptions directly`).not.toContain("stripe.subscriptions.create");
  }
});
