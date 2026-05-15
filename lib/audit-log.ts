import { SupabaseClient } from "@supabase/supabase-js";

export type AuditChangeType = "created" | "edited" | "sent" | "deleted";

export async function logEstimateChange(
  supabaseAdmin: SupabaseClient<any>,
  estimateId: string,
  userId: string,
  changeType: AuditChangeType,
  oldValue?: unknown,
  newValue?: unknown
): Promise<void> {
  try {
    await (supabaseAdmin as any)
      .from("tpe_estimate_changes")
      .insert({
        estimate_id: estimateId,
        user_id: userId,
        change_type: changeType,
        old_value: oldValue ? JSON.stringify(oldValue) : null,
        new_value: newValue ? JSON.stringify(newValue) : null,
      });
  } catch (err) {
    console.error("[audit-log] failed to log change:", err instanceof Error ? err.message : err);
  }
}
