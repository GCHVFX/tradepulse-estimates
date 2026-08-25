/**
 * The account-provisioning sequence shared by email/password signup and the
 * Google OAuth callback, plus the compensating cleanup that runs when any
 * step of it fails.
 *
 * Why this exists as its own module: both call sites created a Stripe
 * customer and a trial subscription before writing the tpe_businesses row,
 * but neither undid the Stripe side when that write failed. The result was a
 * live Stripe customer holding a trialing subscription with no business row
 * and, because the Auth user was deleted first, no user_id that resolved to
 * anything. Those orphans are unattributable after the fact.
 *
 * Every dependency is injected so the ordering and the compensation rules are
 * unit-testable without Stripe, Supabase, or any network access.
 */

import { isMissingStripeObject } from "./stripe-object-state";
import type { Currency } from "./currency";

export type ProvisioningPlan = "starter" | "pro";

/** Which step failed. Also the `operation` reported on a cleanup failure. */
export type ProvisioningStage = "customer" | "subscription" | "business";

export interface ProvisionedSubscription {
  id: string;
  /** Unix seconds, straight from Stripe. Null when Stripe returned none. */
  trialEnd: number | null;
}

export interface BusinessProvisioningRecord {
  customerId: string;
  subscriptionId: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

export interface ProvisioningCleanupFailure {
  userId: string;
  customerId: string | null;
  subscriptionId: string | null;
  /** The provisioning step that failed first. */
  operation: ProvisioningStage;
  /** The step of the cleanup that then failed. */
  cleanupStep: "business" | "customer" | "auth";
  provisioningError: unknown;
  cleanupError: unknown;
}

export interface AccountProvisioningDependencies {
  createCustomer(input: { userId: string; email?: string }): Promise<{ id: string }>;
  createTrialSubscription(input: { customerId: string; currency: Currency }): Promise<ProvisionedSubscription>;
  /** Caller owns the row shape; this module owns the sequence. */
  writeBusiness(record: BusinessProvisioningRecord): Promise<void>;
  deleteBusinessRow(userId: string): Promise<void>;
  /** Deleting the customer also cancels any subscription attached to it. */
  deleteCustomer(customerId: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  reportCleanupFailure(failure: ProvisioningCleanupFailure): void;
  now?: () => number;
}

export interface ProvisionNewAccountInput {
  userId: string;
  email?: string;
  plan: ProvisioningPlan;
  /** Billing currency for the trial subscription. Stripe locks it here. */
  currency: Currency;
  /**
   * False for Google OAuth, where the Auth identity is the person's own
   * Google account and must survive a failed attempt so they can retry.
   * True for email/password, where the identity was created by this request
   * and would otherwise block the address from being reused.
   */
  deleteAuthUserOnFailure: boolean;
}

export type ProvisionNewAccountResult =
  | ({ ok: true } & BusinessProvisioningRecord)
  | {
      ok: false;
      stage: ProvisioningStage;
      /** True when compensation could not fully undo the attempt. */
      cleanupFailed: boolean;
      /** True when the Auth identity is still present after compensation. */
      authUserPreserved: boolean;
      error: unknown;
    };

const TRIAL_DAYS = 14;

function trialEndsAtIso(trialEnd: number | null, nowMs: number): string {
  if (trialEnd !== null) return new Date(trialEnd * 1000).toISOString();
  return new Date(nowMs + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Undoes a failed attempt, in the one order that keeps a partial failure
 * traceable: business row, then Stripe customer (which cancels its
 * subscription), then the Auth user last.
 *
 * Auth-user-last matters. Deleting it first, as both call sites used to,
 * removes the only handle that ties a surviving Stripe customer back to a
 * person. If any earlier step fails we stop and leave the Auth user in place
 * rather than manufacturing exactly that orphan.
 */
async function compensate(
  deps: AccountProvisioningDependencies,
  input: {
    userId: string;
    customerId: string | null;
    subscriptionId: string | null;
    stage: ProvisioningStage;
    deleteAuthUserOnFailure: boolean;
    provisioningError: unknown;
  }
): Promise<{ cleanupFailed: boolean; authUserPreserved: boolean }> {
  const { userId, customerId, subscriptionId, stage, provisioningError } = input;

  const report = (cleanupStep: ProvisioningCleanupFailure["cleanupStep"], cleanupError: unknown) => {
    deps.reportCleanupFailure({
      userId,
      customerId,
      subscriptionId,
      operation: stage,
      cleanupStep,
      provisioningError,
      cleanupError,
    });
  };

  // Only the business step can have left a partial row behind. The earlier
  // stages never attempted that write.
  if (stage === "business") {
    try {
      await deps.deleteBusinessRow(userId);
    } catch (error) {
      report("business", error);
      return { cleanupFailed: true, authUserPreserved: true };
    }
  }

  if (customerId) {
    try {
      await deps.deleteCustomer(customerId);
    } catch (error) {
      // An already-absent customer is the state we were trying to reach.
      if (!isMissingStripeObject(error)) {
        report("customer", error);
        return { cleanupFailed: true, authUserPreserved: true };
      }
    }
  }

  if (!input.deleteAuthUserOnFailure) {
    return { cleanupFailed: false, authUserPreserved: true };
  }

  try {
    await deps.deleteAuthUser(userId);
  } catch (error) {
    report("auth", error);
    return { cleanupFailed: true, authUserPreserved: true };
  }

  return { cleanupFailed: false, authUserPreserved: false };
}

/**
 * Creates the Stripe customer, the Starter trial subscription, and the
 * business row, in that order, and compensates the whole attempt if any of
 * them fails.
 *
 * There is no fallback path. A failed subscription create is never retried
 * with different arguments, so one call can never leave two subscriptions
 * behind.
 */
export async function provisionNewAccount(
  deps: AccountProvisioningDependencies,
  input: ProvisionNewAccountInput
): Promise<ProvisionNewAccountResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const { userId, email, plan, currency, deleteAuthUserOnFailure } = input;

  let customerId: string | null = null;
  let subscriptionId: string | null = null;

  const fail = async (stage: ProvisioningStage, error: unknown): Promise<ProvisionNewAccountResult> => {
    const { cleanupFailed, authUserPreserved } = await compensate(deps, {
      userId,
      customerId,
      subscriptionId,
      stage,
      deleteAuthUserOnFailure,
      provisioningError: error,
    });
    return { ok: false, stage, cleanupFailed, authUserPreserved, error };
  };

  try {
    const customer = await deps.createCustomer({ userId, email });
    customerId = customer.id;
  } catch (error) {
    return fail("customer", error);
  }

  let subscriptionStatus = "trial";
  let trialEndsAt: string | null = trialEndsAtIso(null, nowMs);

  if (plan === "starter") {
    try {
      const subscription = await deps.createTrialSubscription({ customerId, currency });
      subscriptionId = subscription.id;
      trialEndsAt = trialEndsAtIso(subscription.trialEnd, nowMs);
    } catch (error) {
      return fail("subscription", error);
    }
  } else {
    // Pro is paid up front. No trial and no subscription yet: the user goes
    // straight to Stripe Checkout after this. Unchanged behaviour.
    subscriptionStatus = "incomplete";
    trialEndsAt = null;
  }

  const record: BusinessProvisioningRecord = {
    customerId,
    subscriptionId,
    subscriptionStatus,
    trialEndsAt,
  };

  try {
    await deps.writeBusiness(record);
  } catch (error) {
    return fail("business", error);
  }

  return { ok: true, ...record };
}
