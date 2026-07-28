import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// Starter gets a taste of AI photo estimates, capped per calendar month.
// Pro is unlimited (still subject to the short-window abuse throttle in
// analyze-photo/route.ts). Lives here rather than in the route file itself
// so app/new/page.tsx (a client component) can import just the number for
// display without pulling in server-only route dependencies.
export const STARTER_MONTHLY_PHOTO_LIMIT = 3;

// For a rate limit that should reset on the calendar month boundary rather
// than N days after first use. Pass the result as windowSeconds to
// checkRateLimit -- the window's length is the only thing that differs from
// a normal rolling window, the increment/reset mechanism underneath is the
// same either way.
export function secondsUntilNextMonthUTC(): number {
  const now = new Date();
  const nextMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.round((nextMonthStart - now.getTime()) / 1000);
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

  // Increment the active window atomically. A single UPDATE ... SET count =
  // count + 1 in the database (via increment_rate_limit) avoids the
  // check-then-update race where concurrent requests read the same stale count
  // and both slip under the limit. Returns the incremented row when an active
  // window exists, and nothing when it does not (missing or expired).
  const { data: incremented } = await supabaseAdmin.rpc("increment_rate_limit", {
    p_key: key,
    p_action: action,
  });

  const row = incremented?.[0];
  if (row) {
    const newCount = row.new_count;
    return {
      allowed: newCount <= limit,
      remaining: Math.max(0, limit - newCount),
      resetAt: new Date(row.window_expires_at),
    };
  }

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