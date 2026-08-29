/**
 * Customer-facing DISPLAY of subscription state -- badges, upgrade prompts.
 * Deliberately separate from lib/auth.ts's access-decision logic
 * (hasProPaymentsAccess, checkUserSubscriptionAccess): a display bug and an
 * access bug are different classes of risk, and this file should never be
 * imported by anything that decides whether a request is allowed through.
 */

export type DisplaySubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "complimentary";

/**
 * The subscription_status value to use for display, correcting one specific
 * data state that is never legitimate: a Pro-plan business whose stored
 * subscription_status still reads "trial".
 *
 * Pro is paid up front and has no real trial -- lib/account-provisioning.ts
 * sets subscriptionStatus to "incomplete" for a Pro signup, never "trial".
 * So plan === "pro" with subscription_status === "trial" only happens when a
 * business started as Starter (a real 14-day trial) and then upgraded to
 * Pro, and the webhook's plan update landed before (or without) its
 * subscription_status update -- exactly the 2026-08-29 production bug this
 * function was added for: a completed, paid, Stripe-active Pro checkout
 * left a paying customer's profile reading "Free trial". Treating that
 * specific combination as "active" for display is reading the existing
 * plan/subscription_status contract correctly, not inventing a new state --
 * a Pro business cannot actually be mid-trial.
 *
 * Every other combination passes through unchanged.
 */
export function resolveDisplaySubscriptionStatus(
  subscriptionStatus: string | null | undefined,
  plan: string | null | undefined
): string | null | undefined {
  if (plan === "pro" && subscriptionStatus === "trial") return "active";
  return subscriptionStatus;
}

export interface ProfileBadgeCopy {
  label: string;
  colorClass: "emerald" | "amber" | "red" | "zinc";
}

/**
 * What the Profile page's status badge should say, given the raw stored
 * subscription_status and plan. Pure and directly testable -- no JSX, no
 * database access -- so "does a paying Pro subscriber ever see Free trial"
 * is a question a unit test can ask directly.
 */
export function resolveProfileBadge(
  subscriptionStatus: string | null | undefined,
  plan: string | null | undefined
): ProfileBadgeCopy | null {
  const status = resolveDisplaySubscriptionStatus(subscriptionStatus, plan);
  switch (status) {
    case "active":
      return { label: "Subscription active", colorClass: "emerald" };
    case "trial":
      return { label: "Free trial", colorClass: "amber" };
    case "past_due":
      return { label: "Payment issue", colorClass: "red" };
    case "cancelled":
      return { label: "Subscription cancelled", colorClass: "zinc" };
    case "complimentary":
      return { label: "Complimentary", colorClass: "emerald" };
    default:
      return null;
  }
}
