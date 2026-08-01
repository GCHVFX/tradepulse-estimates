import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Shape needed to decide Pro Payments entitlement. Deliberately loose so both
 * a route's own business lookup and the reminder cron's batched lookup can
 * pass their row straight in without reshaping it.
 */
export interface ProPaymentsBusiness {
  plan?: string | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
}

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
 * itself. The subscription half mirrors checkUserSubscriptionAccess() below
 * and the identical inline check in /api/price-book; this is the one place
 * the combined rule lives, so the three Payments call sites cannot drift.
 *
 * `now` is injectable so trial-expiry behaviour is testable without waiting.
 */
export function hasProPaymentsAccess(
  business: ProPaymentsBusiness | null | undefined,
  now: Date = new Date()
): boolean {
  if (!business) return false;
  if (business.plan !== "pro") return false;

  const status = business.subscription_status;
  if (status === "active" || status === "complimentary") return true;
  if (status === "trial" && business.trial_ends_at) {
    return new Date(business.trial_ends_at) > now;
  }
  return false;
}

export async function checkUserSubscriptionAccess(
  userId: string,
  supabaseAdmin: SupabaseClient<Database>
): Promise<{ hasAccess: boolean; status: string }> {
  const { data: sub } = await supabaseAdmin
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at")
    .eq("owner_user_id", userId)
    .maybeSingle();

  const isActive = sub?.subscription_status === "active";
  const isTrialing =
    sub?.subscription_status === "trial" &&
    sub?.trial_ends_at &&
    new Date(sub.trial_ends_at) > new Date();
  const hasAccess =
    isActive || isTrialing || sub?.subscription_status === "complimentary";

  return { hasAccess, status: sub?.subscription_status ?? "none" };
}
