import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";
import {
  createStripeWebhookHandler,
  type StripeWebhookStore,
  type StripeWebhookLinkCheckoutUpdate,
} from "@/lib/stripe-webhook";

const store: StripeWebhookStore = {
  async findBusinessByCustomer(customerId) {
    const { data, error } = await supabaseAdmin
      .from("tpe_businesses")
      .select("owner_user_id, stripe_subscription_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (error) throw new Error(`Business lookup failed: ${error.message}`);
    if (!data?.owner_user_id) return null;

    return {
      ownerUserId: data.owner_user_id,
      stripeSubscriptionId: data.stripe_subscription_id,
    };
  },

  async linkCheckout({
    customerId,
    ownerUserId,
    expectedSubscriptionId,
    subscriptionId,
    plan,
    subscriptionStatus,
    trialEndsAt,
  }) {
    const update: StripeWebhookLinkCheckoutUpdate = { stripe_subscription_id: subscriptionId, plan };
    if (subscriptionStatus) update.subscription_status = subscriptionStatus;
    if (trialEndsAt !== undefined) update.trial_ends_at = trialEndsAt;

    const query = supabaseAdmin
      .from("tpe_businesses")
      .update(update)
      .eq("stripe_customer_id", customerId)
      .eq("owner_user_id", ownerUserId);
    const { data, error } = expectedSubscriptionId
      ? await query
          .eq("stripe_subscription_id", expectedSubscriptionId)
          .select("id")
          .maybeSingle()
      : await query
          .is("stripe_subscription_id", null)
          .select("id")
          .maybeSingle();

    if (error) throw new Error(`Checkout link failed: ${error.message}`);
    return data !== null;
  },

  async syncSubscription({
    customerId,
    expectedSubscriptionId,
    update,
  }) {
    const query = supabaseAdmin
      .from("tpe_businesses")
      .update(update)
      .eq("stripe_customer_id", customerId);
    const { error } = expectedSubscriptionId
      ? await query.eq("stripe_subscription_id", expectedSubscriptionId)
      : await query.is("stripe_subscription_id", null);

    if (error) throw new Error(`Subscription sync failed: ${error.message}`);
  },

  async updateCurrentSubscriptionStatus({ customerId, subscriptionId, status }) {
    const { error } = await supabaseAdmin
      .from("tpe_businesses")
      .update({ subscription_status: status })
      .eq("stripe_customer_id", customerId)
      .eq("stripe_subscription_id", subscriptionId);

    if (error) throw new Error(`Subscription status update failed: ${error.message}`);
  },
};

export const POST = createStripeWebhookHandler({
  stripe,
  store,
  getWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  getStarterPriceId: () => process.env.STRIPE_PRICE_ID,
  getProPriceId: () => process.env.STRIPE_PRO_PRICE_ID,
});
