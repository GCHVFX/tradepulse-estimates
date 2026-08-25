/**
 * Real Stripe and Supabase wiring for provisionNewAccount().
 *
 * Kept out of lib/account-provisioning.ts so that module stays free of
 * server-only imports and can be unit-tested with plain fakes. Both call
 * sites (email/password signup and the Google OAuth callback) share
 * everything here except the business row they write, which they pass in.
 */

import * as Sentry from "@sentry/nextjs";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-server";
import type {
  AccountProvisioningDependencies,
  BusinessProvisioningRecord,
  ProvisioningCleanupFailure,
} from "@/lib/account-provisioning";

/**
 * Reports a cleanup failure with enough context to reconcile the leftovers by
 * hand. This is the one case where an orphan can still exist, so the ids have
 * to survive into the alert.
 */
export function reportProvisioningCleanupFailure(failure: ProvisioningCleanupFailure): void {
  const context = {
    userId: failure.userId,
    customerId: failure.customerId,
    subscriptionId: failure.subscriptionId,
    operation: failure.operation,
    cleanupStep: failure.cleanupStep,
    provisioningError:
      failure.provisioningError instanceof Error
        ? failure.provisioningError.message
        : String(failure.provisioningError),
    cleanupError:
      failure.cleanupError instanceof Error ? failure.cleanupError.message : String(failure.cleanupError),
  };

  console.error("[provisioning] cleanup failed, manual reconciliation required:", context);

  Sentry.captureException(
    failure.cleanupError instanceof Error ? failure.cleanupError : new Error("Account provisioning cleanup failed"),
    { extra: context, tags: { area: "account-provisioning", operation: failure.operation } }
  );
}

export function createAccountProvisioningDependencies(
  writeBusiness: (record: BusinessProvisioningRecord) => Promise<void>
): AccountProvisioningDependencies {
  return {
    async createCustomer({ userId, email }) {
      return stripe.customers.create({
        ...(email ? { email } : {}),
        metadata: { user_id: userId },
      });
    },

    async createTrialSubscription({ customerId }) {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: process.env.STRIPE_PRICE_ID! }],
        trial_period_days: 14,
        payment_settings: {
          save_default_payment_method: "on_subscription",
        },
        expand: ["latest_invoice.payment_intent"],
      });
      return { id: subscription.id, trialEnd: subscription.trial_end ?? null };
    },

    writeBusiness,

    async deleteBusinessRow(userId) {
      const { error } = await supabaseAdmin
        .from("tpe_businesses")
        .delete()
        .eq("owner_user_id", userId);
      if (error) throw new Error(error.message);
    },

    // Deleting the customer also cancels any subscription attached to it, so
    // this single call covers both Stripe objects.
    async deleteCustomer(customerId) {
      await stripe.customers.del(customerId);
    },

    async deleteAuthUser(userId) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },

    reportCleanupFailure: reportProvisioningCleanupFailure,
  };
}
