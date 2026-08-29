/**
 * The single source of truth for "does this business have access to the app",
 * and for the corrected subscription status both that decision and the
 * customer-facing badge are derived from.
 *
 * Before this file existed, eight call sites (proxy.ts, lib/auth.ts's two
 * functions, and five API routes) each reimplemented the same
 * `isActive || isTrialing || complimentary` check against the raw stored
 * subscription_status, while lib/subscription-display.ts separately resolved
 * a *corrected* status for the UI. The two could disagree, and did: a Pro
 * business stuck at subscription_status "trial" past trial_ends_at rendered
 * an "Active" badge while every gate still redirected it to /subscribe, with
 * no explanation shown to the customer. Both the gate and the badge now go
 * through resolveSubscriptionStatus() here, so that class of disagreement is
 * structurally impossible rather than a thing to keep in sync by hand.
 */

/**
 * Whether a stored stripe_subscription_id represents a real subscription.
 * Blank-checked (trim + truthy), not nullish-checked, matching the
 * convention in lib/site-url.ts and lib/twilio-send.ts -- an empty string is
 * not nullish, so a `??`-only check would treat "" as a live subscription.
 *
 * "Live" here means "this business has a Stripe subscription on record". It
 * deliberately does not call Stripe: this runs in proxy.ts on every
 * authenticated request, where a network round trip per navigation is not
 * acceptable. Stripe's own view of that subscription reaches us through the
 * billing webhook, which writes subscription_status.
 */
export function hasLiveSubscriptionId(stripeSubscriptionId: string | null | undefined): boolean {
  return Boolean(stripeSubscriptionId?.trim());
}

/**
 * The subscription_status to reason from, correcting one specific stored
 * state that is never legitimate: a Pro-plan business, with a real Stripe
 * subscription on record, whose subscription_status still reads "trial".
 *
 * Pro is paid up front and has no trial -- lib/account-provisioning.ts sets
 * "incomplete" for a direct Pro signup, never "trial". So plan "pro" +
 * status "trial" only arises when a business started on Starter (a real
 * 14-day trial) and upgraded to Pro, and the billing webhook's plan update
 * landed without its subscription_status update. That was the confirmed
 * 2026-08-29 production bug: a paid, Stripe-active Pro subscription left
 * reading "trial", showing "Free trial" to a paying customer and (once
 * trial_ends_at passed) locking them out entirely.
 *
 * The stripe_subscription_id condition is what keeps this narrow. A Pro-plan
 * row with no subscription on record has not paid for anything, so it is not
 * rescued here -- it keeps whatever status it actually has, and the gate
 * treats it accordingly. Reading plan + a live subscription id as "this is a
 * paying subscriber" is applying the existing plan/subscription_status
 * contract, not inventing a new state.
 *
 * Every other combination passes through unchanged.
 */
export function resolveSubscriptionStatus(
  subscriptionStatus: string | null | undefined,
  plan: string | null | undefined,
  stripeSubscriptionId: string | null | undefined
): string | null | undefined {
  if (plan === "pro" && subscriptionStatus === "trial" && hasLiveSubscriptionId(stripeSubscriptionId)) {
    return "active";
  }
  return subscriptionStatus;
}

/**
 * Shape needed to decide access. Deliberately loose (all optional, all
 * nullable) so every call site can pass its own business row straight in
 * without reshaping it, and so a missing row is simply `null`.
 */
export interface SubscriptionAccessBusiness {
  plan?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  stripe_subscription_id?: string | null;
}

/** Every column hasSubscriptionAccess() reads. Call sites select this string
 * (plus whatever else they need) so no route can accidentally omit a column
 * the predicate depends on and silently get a different answer. */
export const SUBSCRIPTION_ACCESS_COLUMNS =
  "plan, subscription_status, trial_ends_at, stripe_subscription_id";

/**
 * Whether a business may use the app at all.
 *
 * Access is granted when the *resolved* status is:
 *   - "active"         -- a paying subscriber, including a Pro business whose
 *                         stored status is still the stale "trial" (see
 *                         resolveSubscriptionStatus)
 *   - "complimentary"  -- unchanged from the original rule, no date involved
 *   - "trial"          -- only while trial_ends_at is still in the future,
 *                         which is the real Starter trial
 *
 * Everything else -- past_due, cancelled/canceled, unpaid, incomplete, an
 * unrecognized value, a missing status, or a missing business entirely --
 * is denied, exactly as every one of the eight original call sites did.
 *
 * `now` is injectable so trial-expiry behaviour is testable without waiting.
 *
 * Declared as a type predicate because granting access necessarily implies a
 * business row exists. Several call sites (generate-estimate, price-book)
 * previously got that narrowing for free from TypeScript's analysis of their
 * inline `business?.…` checks and go on to read `business.id` afterward; the
 * predicate form preserves that rather than pushing `!` assertions into
 * every caller.
 */
export function hasSubscriptionAccess<T extends SubscriptionAccessBusiness>(
  business: T | null | undefined,
  now: Date = new Date()
): business is T {
  if (!business) return false;

  const status = resolveSubscriptionStatus(
    business.subscription_status,
    business.plan,
    business.stripe_subscription_id
  );

  if (status === "active" || status === "complimentary") return true;
  if (status === "trial" && business.trial_ends_at) {
    return new Date(business.trial_ends_at) > now;
  }
  return false;
}
