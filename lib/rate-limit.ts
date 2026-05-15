import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function checkRateLimit(
  supabaseAdmin: SupabaseClient<Database>,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);

  // Try to find existing record
  const { data: existing } = await supabaseAdmin
    .from("tpe_rate_limits")
    .select("count, expires_at")
    .eq("key", key)
    .eq("action", action)
    .maybeSingle();

  if (existing && new Date(existing.expires_at) > now) {
    // Window still active
    const newCount = existing.count + 1;
    const allowed = newCount <= limit;

    // Increment counter
    await supabaseAdmin
      .from("tpe_rate_limits")
      .update({ count: newCount })
      .eq("key", key)
      .eq("action", action);

    return {
      allowed,
      remaining: Math.max(0, limit - newCount),
      resetAt: new Date(existing.expires_at),
    };
  } else {
    // New window
    await supabaseAdmin.from("tpe_rate_limits").upsert({
      key,
      action,
      count: 1,
      expires_at: resetAt.toISOString(),
    });

    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
    };
  }
}