import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountDeletionError,
  cancelOwnedStripeSubscription,
  deleteAuthenticatedAccount,
  hasRecentSignIn,
  type AccountDeletionBusiness,
  type AccountDeletionDependencies,
  type StripeSubscriptionClient,
} from "../../lib/account-deletion";

const userId = "user-1";
const business: AccountDeletionBusiness = {
  id: "business-1",
  ownerUserId: userId,
  stripeCustomerId: "cus-owned",
  stripeSubscriptionId: "sub-owned",
  logoUrl: "https://example.com/logo.png",
};

function createDependencies(events: string[], overrides: Partial<AccountDeletionDependencies> = {}): AccountDeletionDependencies {
  return {
    async findOwnedBusiness() {
      events.push("business");
      return business;
    },
    async listStorageObjects() {
      events.push("storage-list");
      return [
        { bucket: "logos", path: `${userId}/logo` },
        { bucket: "tpe-estimate-photos", path: `${userId}/estimate-1/photo.jpg` },
      ];
    },
    async removeStorageObjects(objects) {
      events.push(`storage-remove:${objects.map((object) => object.path).join(",")}`);
    },
    async cancelSubscription() {
      events.push("stripe-cancel");
    },
    async deleteBusinessData() {
      events.push("database-transaction");
    },
    async deleteAuthUser() {
      events.push("auth-delete");
    },
    async clearSession() {
      events.push("session-clear");
    },
    ...overrides,
  };
}

test("requires exact confirmation and a recent sign-in before any deletion work", async () => {
  const events: string[] = [];
  await expect(
    deleteAuthenticatedAccount({
      confirmation: "delete",
      userId,
      lastSignInAt: new Date().toISOString(),
      dependencies: createDependencies(events),
    })
  ).rejects.toMatchObject({ status: 400 });
  expect(events).toEqual([]);

  await expect(
    deleteAuthenticatedAccount({
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      userId,
      lastSignInAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      dependencies: createDependencies(events),
    })
  ).rejects.toMatchObject({ status: 403 });
  expect(events).toEqual([]);
  expect(hasRecentSignIn(new Date().toISOString())).toBe(true);
});

test("rejects a business that is not owned by the authenticated user", async () => {
  const events: string[] = [];
  await expect(
    deleteAuthenticatedAccount({
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      userId,
      lastSignInAt: new Date().toISOString(),
      dependencies: createDependencies(events, {
        async findOwnedBusiness() {
          events.push("business");
          return { ...business, ownerUserId: "another-user" };
        },
      }),
    })
  ).rejects.toMatchObject({ status: 403 });
  expect(events).toEqual(["business"]);
});

test("removes storage before the dependent-row transaction and deletes Auth last", async () => {
  const events: string[] = [];
  await deleteAuthenticatedAccount({
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
    userId,
    lastSignInAt: new Date().toISOString(),
    dependencies: createDependencies(events),
  });

  expect(events).toEqual([
    "business",
    "stripe-cancel",
    "storage-list",
    `storage-remove:${userId}/logo,${userId}/estimate-1/photo.jpg`,
    "database-transaction",
    "auth-delete",
    "session-clear",
  ]);
});

test("does not delete database rows, Auth, or the session after a storage failure", async () => {
  const events: string[] = [];
  await expect(
    deleteAuthenticatedAccount({
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      userId,
      lastSignInAt: new Date().toISOString(),
      dependencies: createDependencies(events, {
        async removeStorageObjects() {
          events.push("storage-remove");
          throw new Error("Storage unavailable");
        },
      }),
    })
  ).rejects.toThrow("Storage unavailable");
  expect(events).toEqual(["business", "stripe-cancel", "storage-list", "storage-remove"]);
});

test("can safely retry when the business data was already deleted", async () => {
  const events: string[] = [];
  await deleteAuthenticatedAccount({
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
    userId,
    lastSignInAt: new Date().toISOString(),
    dependencies: createDependencies(events, {
      async findOwnedBusiness() {
        events.push("business");
        return null;
      },
    }),
  });
  expect(events).toEqual(["business", "auth-delete", "session-clear"]);
});

test("cancels only the stored active subscription and ignores a missing one", async () => {
  const cancelled: string[] = [];
  const stripe: StripeSubscriptionClient = {
    subscriptions: {
      async retrieve(subscriptionId) {
        expect(subscriptionId).toBe("sub-owned");
        return { customer: "cus-owned", status: "active" };
      },
      async cancel(subscriptionId) {
        cancelled.push(subscriptionId);
      },
    },
  };
  await cancelOwnedStripeSubscription(stripe, business);
  expect(cancelled).toEqual(["sub-owned"]);

  await cancelOwnedStripeSubscription(
    {
      subscriptions: {
        async retrieve() {
          throw { code: "resource_missing" };
        },
        async cancel() {
          throw new Error("cancel must not be called");
        },
      },
    },
    business
  );
});

test("does not cancel a subscription whose stored customer reference does not match", async () => {
  const stripe: StripeSubscriptionClient = {
    subscriptions: {
      async retrieve() {
        return { customer: "cus-unrelated", status: "active" };
      },
      async cancel() {
        throw new Error("cancel must not be called");
      },
    },
  };
  await expect(cancelOwnedStripeSubscription(stripe, business)).rejects.toBeInstanceOf(AccountDeletionError);
});

test("does not cancel a subscription when its customer reference is missing", async () => {
  const stripe: StripeSubscriptionClient = {
    subscriptions: {
      async retrieve() {
        throw new Error("retrieve must not be called");
      },
      async cancel() {
        throw new Error("cancel must not be called");
      },
    },
  };
  await expect(
    cancelOwnedStripeSubscription(stripe, { ...business, stripeCustomerId: null })
  ).rejects.toMatchObject({ status: 409 });
});

test("the database transaction deletes every owned dependency before the business row", () => {
  const migration = readFileSync(
    "supabase/migrations/20260806044126_delete_tradepulse_account_data.sql",
    "utf8"
  );
  const orderedTables = [
    "tpe_payment_reminders",
    "tpe_estimate_changes",
    "tpe_estimate_items",
    "tpe_estimate_line_items",
    "tpe_estimate_photos",
    "tpe_estimates",
    "tpe_pricebook_items",
    "tpe_businesses",
  ];
  const positions = orderedTables.map((table) => migration.indexOf(`delete from public.${table}`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((first, second) => first - second));
  expect(migration).toContain("for update");
  expect(migration).toContain("p_owner_user_id");
});
