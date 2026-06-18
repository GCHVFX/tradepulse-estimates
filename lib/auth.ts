import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

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
