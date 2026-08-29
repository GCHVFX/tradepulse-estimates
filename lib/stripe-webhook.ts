import type Stripe from "stripe";

export type StripeWebhookBusiness = {
  ownerUserId: string;
  stripeSubscriptionId: string | null;
};

export type StripeWebhookPlan = "starter" | "pro";
export type TradePulseSubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "complimentary";

export type StripeWebhookSubscriptionUpdate = {
  stripe_subscription_id: string;
  subscription_status: TradePulseSubscriptionStatus;
  plan: StripeWebhookPlan;
  trial_ends_at?: string | null;
};

export type StripeWebhookLinkCheckoutUpdate = {
  stripe_subscription_id: string;
  plan: StripeWebhookPlan;
  /** Omitted from the write entirely when null -- see toBusinessSubscriptionStatus's
   * doc comment for why a Stripe status can legitimately have no mapping. */
  subscription_status?: TradePulseSubscriptionStatus;
  trial_ends_at?: string | null;
};

export function toWebhookPlan(
  priceIds: readonly string[],
  configuredPrices: {
    starterPriceId: string | undefined;
    proPriceId: string | undefined;
  }
): StripeWebhookPlan | null {
  if (priceIds.length !== 1) return null;

  const [priceId] = priceIds;
  const isStarter = Boolean(configuredPrices.starterPriceId) &&
    priceId === configuredPrices.starterPriceId;
  const isPro = Boolean(configuredPrices.proPriceId) &&
    priceId === configuredPrices.proPriceId;

  if (isStarter === isPro) return null;
  return isPro ? "pro" : "starter";
}

export interface StripeWebhookStore {
  findBusinessByCustomer(customerId: string): Promise<StripeWebhookBusiness | null>;
  linkCheckout(input: {
    customerId: string;
    ownerUserId: string;
    expectedSubscriptionId: string | null;
    subscriptionId: string;
    plan: StripeWebhookPlan;
    /**
     * The Stripe subscription's current status, already mapped by
     * toBusinessSubscriptionStatus() -- null when Stripe reports a status
     * this app has no equivalent for (see that function's doc comment).
     * A checkout's own subscription_status write used to be skipped
     * entirely, relying on a paired customer.subscription.created/updated
     * event to set it -- but webhook delivery order isn't guaranteed, so
     * that event can arrive (and be rejected, see handleSubscriptionChanged's
     * expectedSubscriptionId guard) before this one runs, leaving
     * subscription_status permanently stuck at whatever it was before this
     * checkout (e.g. a Starter trial's "trial", even after a completed,
     * paid Pro checkout). Writing it here too closes that gap.
     */
    subscriptionStatus: TradePulseSubscriptionStatus | null;
    /** Same semantics as StripeWebhookSubscriptionUpdate's field: undefined
     * means "don't touch trial_ends_at", present (including null) means set
     * it to this value. */
    trialEndsAt?: string | null;
  }): Promise<boolean>;
  syncSubscription(input: {
    customerId: string;
    expectedSubscriptionId: string | null;
    subscriptionId: string;
    update: StripeWebhookSubscriptionUpdate;
  }): Promise<void>;
  updateCurrentSubscriptionStatus(input: {
    customerId: string;
    subscriptionId: string;
    status: TradePulseSubscriptionStatus;
  }): Promise<void>;
}

type StripeWebhookDependencies = {
  stripe: Stripe;
  store: StripeWebhookStore;
  getWebhookSecret: () => string | undefined;
  getStarterPriceId?: () => string | undefined;
  getProPriceId: () => string | undefined;
};

export const SUPPORTED_STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const;

type SupportedStripeWebhookEvent = (typeof SUPPORTED_STRIPE_WEBHOOK_EVENTS)[number];

function isSupportedEvent(type: string): type is SupportedStripeWebhookEvent {
  return (SUPPORTED_STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type);
}

function getObjectId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function getCustomerId(object: unknown): string | null {
  if (!object || typeof object !== "object" || !("customer" in object)) return null;
  return getObjectId((object as { customer?: string | { id: string } | null }).customer);
}

function getSubscriptionPlan(
  subscription: Stripe.Subscription,
  dependencies: StripeWebhookDependencies
): { plan: StripeWebhookPlan | null; priceItemCount: number } {
  const priceIds = subscription.items.data
    .map((item) => item.price?.id)
    .filter((priceId): priceId is string => Boolean(priceId));

  return {
    plan: toWebhookPlan(priceIds, {
      starterPriceId: dependencies.getStarterPriceId?.(),
      proPriceId: dependencies.getProPriceId(),
    }),
    priceItemCount: priceIds.length,
  };
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  dependencies: StripeWebhookDependencies
): Promise<void> {
  const customerId = getCustomerId(session);
  const subscriptionId = getObjectId(session.subscription);
  const ownerUserId = session.metadata?.user_id;
  const plan = session.metadata?.plan;
  const previousSubscriptionId = session.metadata?.previous_subscription_id;

  if (
    !customerId ||
    !subscriptionId ||
    !ownerUserId ||
    (plan !== "starter" && plan !== "pro")
  ) {
    return;
  }

  const business = await dependencies.store.findBusinessByCustomer(customerId);
  if (!business || business.ownerUserId !== ownerUserId) return;

  if (
    business.stripeSubscriptionId &&
    business.stripeSubscriptionId !== subscriptionId &&
    business.stripeSubscriptionId !== previousSubscriptionId
  ) {
    return;
  }

  const subscription = await dependencies.stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionCustomerId = getCustomerId(subscription);
  const { plan: recognizedPlan, priceItemCount } = getSubscriptionPlan(
    subscription,
    dependencies
  );

  if (
    subscription.id !== subscriptionId ||
    subscriptionCustomerId !== customerId ||
    !recognizedPlan ||
    recognizedPlan !== plan
  ) {
    console.warn("[webhook] ignored Checkout with an invalid subscription relationship", {
      customerMatches: subscriptionCustomerId === customerId,
      planRecognized: recognizedPlan !== null,
      priceItemCount,
    });
    return;
  }

  // Set subscription_status (and, when trialing, trial_ends_at) directly from
  // the subscription this handler already retrieved above -- not dependent
  // on a separate customer.subscription.created/updated event to arrive and
  // be accepted. See linkCheckout's doc comment for why that dependency was
  // the actual bug.
  const subscriptionStatus = toBusinessSubscriptionStatus(subscription.status);
  if (!subscriptionStatus) {
    console.warn("[webhook] checkout completed with an unsupported Stripe subscription status", {
      status: subscription.status,
    });
  }
  const trialEndsAt = subscription.status === "trialing"
    ? (subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null)
    : undefined;

  const linked = await dependencies.store.linkCheckout({
    customerId,
    ownerUserId,
    expectedSubscriptionId: business.stripeSubscriptionId,
    subscriptionId,
    plan: recognizedPlan,
    subscriptionStatus,
    trialEndsAt,
  });

  if (!linked) {
    console.warn("[webhook] checkout link refused because the expected business state changed");
    return;
  }

  if (
    previousSubscriptionId &&
    previousSubscriptionId !== subscriptionId
  ) {
    try {
      const previous = await dependencies.stripe.subscriptions.retrieve(previousSubscriptionId);
      if (getCustomerId(previous) !== customerId) {
        console.warn("[webhook] ignored previous trial with a mismatched Stripe customer");
        return;
      }
      if (previous.status === "trialing") {
        await dependencies.stripe.subscriptions.cancel(previousSubscriptionId);
      }
    } catch (error) {
      console.error(
        "[webhook] failed to cancel previous trial:",
        error instanceof Error ? error.message : "Unknown Stripe error"
      );
      throw new Error("Previous trial cancellation failed");
    }
  }
}

/**
 * Maps every Stripe Subscription.status value to a TradePulse
 * subscription_status. Stripe's status enum has exactly eight values
 * (incomplete, incomplete_expired, trialing, active, past_due, canceled,
 * unpaid, paused) and all eight are mapped below -- there is currently no
 * Stripe status this app lacks an equivalent for. The `default: return null`
 * branch exists purely as a defensive fallback for a future Stripe status
 * this mapping hasn't been updated for yet, not because a real gap exists
 * today. A null result means "don't touch subscription_status", never an
 * invented value.
 */
export function toBusinessSubscriptionStatus(
  status: string
): TradePulseSubscriptionStatus | null {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trial";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
      return "past_due";
    case "incomplete_expired":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

async function handleSubscriptionChanged(
  subscription: Stripe.Subscription,
  dependencies: StripeWebhookDependencies
): Promise<void> {
  const customerId = getCustomerId(subscription);
  if (!customerId || !subscription.id) return;

  const business = await dependencies.store.findBusinessByCustomer(customerId);
  if (!business) return;
  if (
    business.stripeSubscriptionId &&
    business.stripeSubscriptionId !== subscription.id
  ) {
    return;
  }

  const subscriptionStatus = toBusinessSubscriptionStatus(subscription.status);
  if (!subscriptionStatus) {
    console.warn("[webhook] ignored subscription with an unsupported status");
    return;
  }

  const { plan, priceItemCount } = getSubscriptionPlan(subscription, dependencies);
  if (!plan) {
    console.warn("[webhook] ignored subscription with an unrecognized price configuration", {
      priceItemCount,
    });
    return;
  }

  const update: StripeWebhookSubscriptionUpdate = {
    stripe_subscription_id: subscription.id,
    subscription_status: subscriptionStatus,
    plan,
  };

  if (subscription.status === "trialing") {
    update.trial_ends_at = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null;
  }

  await dependencies.store.syncSubscription({
    customerId,
    expectedSubscriptionId: business.stripeSubscriptionId,
    subscriptionId: subscription.id,
    update,
  });
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  dependencies: StripeWebhookDependencies
): Promise<void> {
  const customerId = getCustomerId(subscription);
  if (!customerId || !subscription.id) return;

  const business = await dependencies.store.findBusinessByCustomer(customerId);
  if (!business || business.stripeSubscriptionId !== subscription.id) return;

  await dependencies.store.updateCurrentSubscriptionStatus({
    customerId,
    subscriptionId: subscription.id,
    status: "cancelled",
  });
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  if (invoice.parent?.type !== "subscription_details") return null;
  return getObjectId(invoice.parent.subscription_details?.subscription);
}

async function handleInvoiceStatus(
  invoice: Stripe.Invoice,
  status: "active" | "past_due",
  dependencies: StripeWebhookDependencies
): Promise<void> {
  if (status === "active" && invoice.amount_paid <= 0) return;

  const customerId = getCustomerId(invoice);
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!customerId || !subscriptionId) return;

  const business = await dependencies.store.findBusinessByCustomer(customerId);
  if (!business || business.stripeSubscriptionId !== subscriptionId) return;

  const subscription = await dependencies.stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionStatus = toBusinessSubscriptionStatus(subscription.status);
  const customerMatches = getCustomerId(subscription) === customerId;
  if (
    subscription.id !== subscriptionId ||
    !customerMatches ||
    !subscriptionStatus ||
    (status === "active" && subscriptionStatus !== "active") ||
    (status === "past_due" && subscriptionStatus === "cancelled")
  ) {
    console.warn("[webhook] ignored invoice with an invalid subscription state", {
      customerMatches,
      statusRecognized: subscriptionStatus !== null,
    });
    return;
  }

  await dependencies.store.updateCurrentSubscriptionStatus({
    customerId,
    subscriptionId,
    status,
  });
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

export function createStripeWebhookHandler({
  stripe,
  store,
  getWebhookSecret,
  getStarterPriceId,
  getProPriceId,
}: StripeWebhookDependencies): (request: Request) => Promise<Response> {
  const dependencies = {
    stripe,
    store,
    getWebhookSecret,
    getStarterPriceId,
    getProPriceId,
  };

  return async (request: Request): Promise<Response> => {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) return json({ error: "No signature" }, 400);

    const webhookSecret = getWebhookSecret();
    if (!webhookSecret) return json({ error: "Webhook not configured" }, 500);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch {
      return json({ error: "Webhook signature verification failed" }, 400);
    }

    if (!isSupportedEvent(event.type)) return json({ received: true });

    try {
      if (event.type === "checkout.session.completed") {
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, dependencies);
      }
      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated"
      ) {
        await handleSubscriptionChanged(event.data.object as Stripe.Subscription, dependencies);
      }
      if (event.type === "customer.subscription.deleted") {
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, dependencies);
      }
      if (event.type === "invoice.payment_succeeded") {
        await handleInvoiceStatus(event.data.object as Stripe.Invoice, "active", dependencies);
      }
      if (event.type === "invoice.payment_failed") {
        await handleInvoiceStatus(event.data.object as Stripe.Invoice, "past_due", dependencies);
      }
    } catch (error) {
      console.error(
        "[webhook] event processing failed:",
        error instanceof Error ? error.message : "Unknown webhook error"
      );
      return json({ error: "Webhook processing failed" }, 500);
    }

    return json({ received: true });
  };
}
