import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  hasSubscriptionAccess,
  SUBSCRIPTION_ACCESS_COLUMNS,
  type SubscriptionAccessBusiness,
} from "@/lib/subscription-access";

/**
 * Shape needed to decide Pro Payments entitlement. Deliberately loose so both
 * a route's own business lookup and the reminder cron's batched lookup can
 * pass their row straight in without reshaping it.
 */
export type ProPaymentsBusiness = SubscriptionAccessBusiness;

/**
 * Whether a business may use the Pro Payments feature (invoicing, marking
 * paid, and automated payment reminders).
 *
 * Two independent things have to hold, per the plan/subscription split in
 * CLAUDE.md:
 *   - `plan === 'pro'`, which is what gates the feature itself.
 *   - The subscription is live (active, complimentary, or a trial that has
 *     not expired), which is what gates using the app at all.
 *
 * Both matter here. Checking only the plan would keep sending automated
 * reminders on behalf of a Pro business whose subscription lapsed months ago,
 * and those reminders go to that business's customers, not to the business
 * itself.
 *
 * The subscription half is delegated to hasSubscriptionAccess() rather than
 * reimplemented -- this function is the Pro-plan gate composed with the app's
 * one access rule, not a second copy of that rule. That composition is the
 * genuine difference between this and every other former call site, and is
 * why it stayed a separate function through the consolidation.
 *
 * `now` is injectable so trial-expiry behaviour is testable without waiting.
 */
export function hasProPaymentsAccess(
  business: ProPaymentsBusiness | null | undefined,
  now: Date = new Date()
): boolean {
  if (!business) return false;
  if (business.plan !== "pro") return false;
  return hasSubscriptionAccess(business, now);
}

export async function checkUserSubscriptionAccess(
  userId: string,
  supabaseAdmin: SupabaseClient<Database>
): Promise<{ hasAccess: boolean; status: string }> {
  const { data: sub } = await supabaseAdmin
    .from("tpe_businesses")
    .select(SUBSCRIPTION_ACCESS_COLUMNS)
    .eq("owner_user_id", userId)
    .maybeSingle();

  // `status` reports the raw stored value, unchanged from before this
  // consolidation. No caller reads it today (send-sms and send-email both
  // destructure only `hasAccess`), so it is left exactly as it was rather
  // than quietly redefined to mean the resolved status.
  return { hasAccess: hasSubscriptionAccess(sub), status: sub?.subscription_status ?? "none" };
}
