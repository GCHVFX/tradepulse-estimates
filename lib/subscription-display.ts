/**
 * Customer-facing DISPLAY of subscription state -- badges, upgrade prompts.
 *
 * The corrected status these render from is NOT computed here: it comes from
 * resolveSubscriptionStatus() in lib/subscription-access.ts, the same
 * function every access gate decides from. That sharing is deliberate and is
 * the point of this file's existence. An earlier version of this comment
 * said display logic "should never be imported by anything that decides
 * whether a request is allowed through", and keeping the two apart is
 * exactly what produced the bug they were split to avoid: a Pro business
 * stuck at subscription_status "trial" past trial_ends_at rendered an
 * "Active" badge while every gate redirected it to /subscribe. Display and
 * access must agree on *what state the business is in*; they may still
 * differ freely on what to do about it, which is what this file owns.
 */
import { resolveSubscriptionStatus } from "@/lib/subscription-access";

export type DisplaySubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "complimentary";

export interface ProfileBadgeCopy {
  label: string;
  colorClass: "emerald" | "amber" | "red" | "zinc";
}

/**
 * What the Profile page's status badge should say, given the raw stored
 * business fields. Pure and directly testable -- no JSX, no database access
 * -- so "does a paying Pro subscriber ever see Free trial" is a question a
 * unit test can ask directly.
 */
export function resolveProfileBadge(
  subscriptionStatus: string | null | undefined,
  plan: string | null | undefined,
  stripeSubscriptionId: string | null | undefined
): ProfileBadgeCopy | null {
  const status = resolveSubscriptionStatus(subscriptionStatus, plan, stripeSubscriptionId);
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
