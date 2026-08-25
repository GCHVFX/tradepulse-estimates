import { expect, test } from "@playwright/test";
import {
  provisionNewAccount,
  type AccountProvisioningDependencies,
  type ProvisioningCleanupFailure,
} from "../../lib/account-provisioning";

const NOW_MS = Date.UTC(2026, 7, 24, 12, 0, 0);
const TRIAL_END_UNIX = Math.floor(Date.UTC(2026, 8, 7, 12, 0, 0) / 1000);

type Overrides = Partial<AccountProvisioningDependencies>;

/**
 * Records every dependency call in order so the tests can assert the exact
 * compensation sequence, not just that cleanup "happened".
 */
function createDeps(events: string[], reported: ProvisioningCleanupFailure[], overrides: Overrides = {}) {
  const base: AccountProvisioningDependencies = {
    async createCustomer() {
      events.push("create-customer");
      return { id: "cus_test" };
    },
    async createTrialSubscription() {
      events.push("create-subscription");
      return { id: "sub_test", trialEnd: TRIAL_END_UNIX };
    },
    async writeBusiness() {
      events.push("write-business");
    },
    async deleteBusinessRow() {
      events.push("delete-business-row");
    },
    async deleteCustomer() {
      events.push("delete-customer");
    },
    async deleteAuthUser() {
      events.push("delete-auth-user");
    },
    reportCleanupFailure(failure) {
      events.push("report-cleanup-failure");
      reported.push(failure);
    },
    now: () => NOW_MS,
  };

  return { ...base, ...overrides };
}

const emailSignup = { userId: "user-1", email: "a@b.com", plan: "starter" as const, currency: "cad" as const, deleteAuthUserOnFailure: true };
const googleSignup = { userId: "user-1", email: "a@b.com", plan: "starter" as const, currency: "cad" as const, deleteAuthUserOnFailure: false };

// ── Success path ──────────────────────────────────────────────────────────────

test("the existing successful signup order is preserved exactly", async () => {
  const events: string[] = [];
  const result = await provisionNewAccount(createDeps(events, []), emailSignup);

  expect(events).toEqual(["create-customer", "create-subscription", "write-business"]);
  expect(result).toEqual({
    ok: true,
    customerId: "cus_test",
    subscriptionId: "sub_test",
    subscriptionStatus: "trial",
    trialEndsAt: new Date(TRIAL_END_UNIX * 1000).toISOString(),
  });
});

test("a Pro signup creates no subscription and stays incomplete", async () => {
  const events: string[] = [];
  const result = await provisionNewAccount(createDeps(events, []), { ...emailSignup, plan: "pro" });

  expect(events).toEqual(["create-customer", "write-business"]);
  expect(events).not.toContain("create-subscription");
  expect(result).toMatchObject({ ok: true, subscriptionId: null, subscriptionStatus: "incomplete", trialEndsAt: null });
});

test("a missing Stripe trial_end falls back to a 14 day trial", async () => {
  const events: string[] = [];
  const deps = createDeps(events, [], {
    async createTrialSubscription() {
      events.push("create-subscription");
      return { id: "sub_test", trialEnd: null };
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);
  expect(result).toMatchObject({
    ok: true,
    trialEndsAt: new Date(NOW_MS + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
});

// ── Failure paths and compensation ordering ───────────────────────────────────

test("a failed Stripe customer create cleans up only the Auth user", async () => {
  const events: string[] = [];
  const deps = createDeps(events, [], {
    async createCustomer() {
      events.push("create-customer");
      throw new Error("stripe down");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(events).toEqual(["create-customer", "delete-auth-user"]);
  expect(events).not.toContain("delete-customer");
  expect(result).toMatchObject({ ok: false, stage: "customer", cleanupFailed: false, authUserPreserved: false });
});

test("a failed subscription create deletes the Stripe customer, then the Auth user, in that order", async () => {
  const events: string[] = [];
  const deps = createDeps(events, [], {
    async createTrialSubscription() {
      events.push("create-subscription");
      throw new Error("no such price");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(events).toEqual(["create-customer", "create-subscription", "delete-customer", "delete-auth-user"]);
  expect(events).not.toContain("write-business");
  expect(result).toMatchObject({ ok: false, stage: "subscription", cleanupFailed: false });
});

test("a failed business upsert deletes the business row, the Stripe customer, then the Auth user last", async () => {
  // This is the regression test for the verified orphan bug: the old code
  // deleted the Auth user and left the customer and its trialing
  // subscription behind, with no user_id resolving to anything.
  const events: string[] = [];
  const deps = createDeps(events, [], {
    async writeBusiness() {
      events.push("write-business");
      throw new Error("column does not exist");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(events).toEqual([
    "create-customer",
    "create-subscription",
    "write-business",
    "delete-business-row",
    "delete-customer",
    "delete-auth-user",
  ]);
  expect(result).toMatchObject({ ok: false, stage: "business", cleanupFailed: false, authUserPreserved: false });
});

test("the Auth user is always deleted last", async () => {
  const events: string[] = [];
  const deps = createDeps(events, [], {
    async writeBusiness() {
      throw new Error("db down");
    },
  });

  await provisionNewAccount(deps, emailSignup);

  expect(events[events.length - 1]).toBe("delete-auth-user");
  expect(events.indexOf("delete-customer")).toBeLessThan(events.indexOf("delete-auth-user"));
  expect(events.indexOf("delete-business-row")).toBeLessThan(events.indexOf("delete-customer"));
});

// ── No duplicate subscription, no silent fallback ─────────────────────────────

test("a failed subscription create is never retried, so one attempt cannot leave two subscriptions", async () => {
  const events: string[] = [];
  let subscriptionAttempts = 0;
  const deps = createDeps(events, [], {
    async createTrialSubscription() {
      subscriptionAttempts += 1;
      events.push("create-subscription");
      throw new Error("currency not available on this price");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(subscriptionAttempts).toBe(1);
  expect(events.filter((e) => e === "create-subscription")).toHaveLength(1);
  expect(result.ok).toBe(false);
});

test("a successful run creates exactly one customer and one subscription", async () => {
  const events: string[] = [];
  await provisionNewAccount(createDeps(events, []), emailSignup);

  expect(events.filter((e) => e === "create-customer")).toHaveLength(1);
  expect(events.filter((e) => e === "create-subscription")).toHaveLength(1);
});

// ── Cleanup failure ───────────────────────────────────────────────────────────

test("a failed customer delete preserves the Auth user and reports actionable context", async () => {
  const events: string[] = [];
  const reported: ProvisioningCleanupFailure[] = [];
  const deps = createDeps(events, reported, {
    async writeBusiness() {
      events.push("write-business");
      throw new Error("db down");
    },
    async deleteCustomer() {
      events.push("delete-customer");
      throw new Error("stripe unreachable");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(events).not.toContain("delete-auth-user");
  expect(result).toMatchObject({ ok: false, stage: "business", cleanupFailed: true, authUserPreserved: true });

  expect(reported).toHaveLength(1);
  expect(reported[0]).toMatchObject({
    userId: "user-1",
    customerId: "cus_test",
    subscriptionId: "sub_test",
    operation: "business",
    cleanupStep: "customer",
  });
  expect(reported[0].cleanupError).toBeInstanceOf(Error);
  expect(reported[0].provisioningError).toBeInstanceOf(Error);
});

test("a failed business row delete stops before Stripe and before the Auth user", async () => {
  const events: string[] = [];
  const reported: ProvisioningCleanupFailure[] = [];
  const deps = createDeps(events, reported, {
    async writeBusiness() {
      events.push("write-business");
      throw new Error("db down");
    },
    async deleteBusinessRow() {
      events.push("delete-business-row");
      throw new Error("db still down");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(events).not.toContain("delete-customer");
  expect(events).not.toContain("delete-auth-user");
  expect(result).toMatchObject({ cleanupFailed: true, authUserPreserved: true });
  expect(reported[0]).toMatchObject({ operation: "business", cleanupStep: "business" });
});

test("a failed Auth user delete is reported and leaves the identity in place", async () => {
  const events: string[] = [];
  const reported: ProvisioningCleanupFailure[] = [];
  const deps = createDeps(events, reported, {
    async writeBusiness() {
      throw new Error("db down");
    },
    async deleteAuthUser() {
      events.push("delete-auth-user");
      throw new Error("auth admin unavailable");
    },
  });

  const result = await provisionNewAccount(deps, emailSignup);

  expect(result).toMatchObject({ cleanupFailed: true, authUserPreserved: true });
  expect(reported[0]).toMatchObject({ operation: "business", cleanupStep: "auth" });
});

// ── Tolerated Stripe states ───────────────────────────────────────────────────

test("an already missing Stripe customer is tolerated during cleanup", async () => {
  for (const missingError of [
    { code: "resource_missing" },
    { statusCode: 404 },
    new Error("No such customer: 'cus_test'"),
  ]) {
    const events: string[] = [];
    const reported: ProvisioningCleanupFailure[] = [];
    const deps = createDeps(events, reported, {
      async writeBusiness() {
        throw new Error("db down");
      },
      async deleteCustomer() {
        events.push("delete-customer");
        throw missingError;
      },
    });

    const result = await provisionNewAccount(deps, emailSignup);

    expect(events).toContain("delete-auth-user");
    expect(reported).toHaveLength(0);
    expect(result).toMatchObject({ cleanupFailed: false, authUserPreserved: false });
  }
});

// ── Google OAuth: the Auth identity survives ─────────────────────────────────

test("Google provisioning failure cleans Stripe but never deletes the Auth identity", async () => {
  const events: string[] = [];
  const deps = createDeps(events, [], {
    async writeBusiness() {
      events.push("write-business");
      throw new Error("db down");
    },
  });

  const result = await provisionNewAccount(deps, googleSignup);

  expect(events).toEqual([
    "create-customer",
    "create-subscription",
    "write-business",
    "delete-business-row",
    "delete-customer",
  ]);
  expect(events).not.toContain("delete-auth-user");
  expect(result).toMatchObject({ ok: false, cleanupFailed: false, authUserPreserved: true });
});

test("a Google retry after a failed attempt provisions cleanly with no leftover Stripe objects", async () => {
  const events: string[] = [];
  let failWrite = true;
  const deps = createDeps(events, [], {
    async writeBusiness() {
      events.push("write-business");
      if (failWrite) throw new Error("transient db error");
    },
  });

  const first = await provisionNewAccount(deps, googleSignup);
  expect(first.ok).toBe(false);
  expect(events.filter((e) => e === "delete-customer")).toHaveLength(1);

  failWrite = false;
  const second = await provisionNewAccount(deps, googleSignup);

  expect(second.ok).toBe(true);
  // One customer created per attempt, and the failed one was deleted, so no
  // Stripe object accumulates across retries.
  expect(events.filter((e) => e === "create-customer")).toHaveLength(2);
  expect(events.filter((e) => e === "delete-customer")).toHaveLength(1);
  expect(events).not.toContain("delete-auth-user");
});
