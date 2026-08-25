/**
 * One rule for the currency an existing business is billed in.
 *
 * This exists because `/subscribe` and `/api/billing/checkout` were deciding
 * it separately. Checkout asked Stripe and fell back to the business estimate
 * currency; `/subscribe` asked nothing and printed a bare `$` in front of a
 * hardcoded CAD number. A US-billed contractor could be shown `$59`, offered
 * `CA$59` on the button, and charged US$39.
 *
 * The order is deliberate and must not be reordered:
 *
 *   1. A current subscription. Stripe locks the currency onto the Customer at
 *      the first subscription and it can never be changed afterwards, so this
 *      is the only real authority once it exists.
 *   2. The business estimate currency, which was itself seeded from the geo
 *      default at signup.
 *
 * Geo deliberately appears nowhere here. An existing customer's billing must
 * never move because they opened a VPN or travelled. Geo only decides the
 * default for someone who has no business yet, which is a signup concern.
 *
 * Both callers pass in the subscription they have already retrieved, so
 * sharing this rule costs no extra Stripe call.
 */
import { currencyOrDefault, type Currency } from "./currency";

/** The shape both callers already have from `stripe.subscriptions.retrieve`. */
export interface BillingSubscription {
  status: string;
  currency: string;
}

/**
 * Stripe keeps cancelled and expired subscriptions readable forever. Neither
 * still locks a currency, so neither may decide what a new checkout is billed
 * in.
 */
const RELEASED_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

export function subscriptionLocksCurrency(status: string): boolean {
  return !RELEASED_STATUSES.has(status);
}

/**
 * The currency a live subscription pins, or null when nothing is pinned yet.
 * A missing subscription and a released one both read as null.
 */
export function lockedSubscriptionCurrency(
  subscription: BillingSubscription | null | undefined
): Currency | null {
  if (!subscription) return null;
  if (!subscriptionLocksCurrency(subscription.status)) return null;
  return currencyOrDefault(subscription.currency);
}

/**
 * The full rule. `readEstimateCurrency` is injected so this stays testable
 * without a database, and so the caller supplies whichever client it holds.
 */
export async function resolveBillingCurrency(input: {
  subscription: BillingSubscription | null | undefined;
  readEstimateCurrency: () => Promise<Currency>;
}): Promise<Currency> {
  return lockedSubscriptionCurrency(input.subscription) ?? (await input.readEstimateCurrency());
}
