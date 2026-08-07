import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// TradePulse sends every automated SMS (payment reminders, review requests,
// estimate sends) from one shared TWILIO_FROM_NUMBER, not a per-business
// Messaging Service -- verified by inspecting app/api/send-sms,
// app/api/cron/payment-reminders, and app/api/estimates/[id]/review-request,
// which all read the same env var with no per-business number lookup.
// Twilio's STOP handling blocks a recipient from that shared number account
// wide, so suppression is keyed by phone number alone, matching Twilio's
// actual behaviour rather than a narrower per-business or per-estimate flag.

/**
 * Normalizes a phone number to E.164 for suppression lookups and the Twilio
 * `to` field. Deliberately matches the normalization already used in
 * app/api/cron/payment-reminders/route.ts (not the Australia-aware variant in
 * app/api/send-sms/route.ts, which is unrelated to payment reminders) so a
 * phone normalizes identically whether it arrives from Twilio's inbound
 * webhook (`From`, already E.164) or from `tpe_estimates.customer_phone`
 * (however the contractor typed it).
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? trimmed : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && !digits.startsWith("0")) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Twilio's error code for "Attempt to send to unsubscribed recipient". */
export const TWILIO_UNSUBSCRIBED_ERROR_CODE = 21610;

export function isTwilioUnsubscribedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === TWILIO_UNSUBSCRIBED_ERROR_CODE;
}

/**
 * The single human-readable message every SMS send path (payment reminders,
 * review requests, manual estimate sends) returns for a suppressed
 * recipient, so a contractor sees the same clear explanation everywhere
 * instead of each route inventing its own wording. Callers already surface
 * `error` strings from these routes directly in their UI (see
 * send-estimate-sheet.tsx and mark-job-done-sheet.tsx), so this string is
 * shown as-is with no further UI work needed.
 */
export const SMS_OPTED_OUT_MESSAGE =
  "This customer has opted out of text messages. Try email instead.";

/** Machine-readable companion to SMS_OPTED_OUT_MESSAGE, for a future caller
 * that wants to branch on the reason rather than match the string. */
export const SMS_OPTED_OUT_CODE = "sms_opted_out";

/**
 * Call from a Twilio send's catch block. If the error is 21610 (recipient
 * unsubscribed), records suppression -- idempotently, via store.suppress(),
 * so a second 21610 for an already-suppressed number is a safe no-op, not a
 * duplicate row or a retry -- and returns true so the caller can return the
 * same SMS_OPTED_OUT_MESSAGE result instead of a generic failure. Returns
 * false for every other error, leaving the caller's existing error handling
 * untouched.
 */
export async function recordSuppressionIfUnsubscribedError(
  store: SmsSuppressionStore,
  phone: string,
  error: unknown
): Promise<boolean> {
  if (!isTwilioUnsubscribedError(error)) return false;
  await store.suppress({ phone, messageSid: null });
  return true;
}

export interface SmsSuppressionStore {
  /** Whether a (normalized) phone is currently opted out of SMS. */
  isSuppressed(phone: string): Promise<boolean>;

  /**
   * Records an opt-out. Idempotent: `newlySuppressed` is true only the first
   * time a given phone transitions from not-suppressed (or never seen) to
   * suppressed, so a caller can gate a one-time side effect (a contractor
   * notification, a log line) on it without that side effect repeating on a
   * duplicate Twilio webhook delivery or a duplicate 21610 error.
   */
  suppress(input: { phone: string; messageSid: string | null }): Promise<{ newlySuppressed: boolean }>;

  /**
   * Records an opt-in. Idempotent the same way: `newlyUnsuppressed` is true
   * only the first time a suppressed phone transitions back to eligible.
   */
  unsuppress(input: { phone: string; messageSid: string | null }): Promise<{ newlyUnsuppressed: boolean }>;
}

/**
 * Supabase-backed store. Both suppress() and unsuppress() are written as an
 * UPDATE ... WHERE <not already in the target state> first, falling back to
 * an INSERT ... ON CONFLICT DO NOTHING when no row exists yet. Each statement
 * is atomic on its own, so two concurrent duplicate deliveries can't both
 * observe "I made the transition" -- at most one UPDATE or one INSERT
 * actually affects a row, which is what newlySuppressed / newlyUnsuppressed
 * reports. This mirrors the compare-and-swap the rate-limit RPC does for a
 * much higher-frequency path, without needing a dedicated Postgres function
 * for a rare inbound-webhook write.
 */
export function createSupabaseSmsSuppressionStore(
  supabaseAdmin: SupabaseClient<Database>
): SmsSuppressionStore {
  return {
    async isSuppressed(phone) {
      const { data } = await supabaseAdmin
        .from("tpe_sms_suppressions")
        .select("sms_opted_out")
        .eq("phone", phone)
        .maybeSingle();
      return data?.sms_opted_out === true;
    },

    async suppress({ phone, messageSid }) {
      const now = new Date().toISOString();

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("tpe_sms_suppressions")
        .update({ sms_opted_out: true, opted_out_at: now, last_message_sid: messageSid, updated_at: now })
        .eq("phone", phone)
        .eq("sms_opted_out", false)
        .select("id")
        .maybeSingle();

      if (updateError) throw new Error(`SMS suppression update failed: ${updateError.message}`);
      if (updated) return { newlySuppressed: true };

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("tpe_sms_suppressions")
        .insert({ phone, sms_opted_out: true, opted_out_at: now, last_message_sid: messageSid })
        .select("id")
        .maybeSingle();

      // A unique-violation here means a row already existed (already
      // suppressed, or a concurrent call just created/updated it) -- not a
      // real failure, just "someone else already recorded this".
      if (insertError && insertError.code !== "23505") {
        throw new Error(`SMS suppression insert failed: ${insertError.message}`);
      }

      return { newlySuppressed: Boolean(inserted) };
    },

    async unsuppress({ phone, messageSid }) {
      const now = new Date().toISOString();

      const { data: updated, error } = await supabaseAdmin
        .from("tpe_sms_suppressions")
        .update({ sms_opted_out: false, opted_in_at: now, last_message_sid: messageSid, updated_at: now })
        .eq("phone", phone)
        .eq("sms_opted_out", true)
        .select("id")
        .maybeSingle();

      if (error) throw new Error(`SMS suppression opt-in update failed: ${error.message}`);
      return { newlyUnsuppressed: Boolean(updated) };
    },
  };
}
