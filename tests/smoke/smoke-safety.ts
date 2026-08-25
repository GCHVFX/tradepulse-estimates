/**
 * Test-only safety rules for smoke tests that create real accounts.
 *
 * Two production incidents motivate this file. A smoke run against Production
 * created 20 live Stripe customers with trialing subscriptions; 19 of them
 * leaked because cleanupTestAccount() deleted the Stripe customer inside a
 * bare `catch {}`, then went on to delete the database and Auth rows anyway.
 * The result was 19 unattributable customers and no local record of them.
 *
 * Nothing here touches the network. Every function is pure so the rules can
 * be tested without creating an account.
 */

export const PRODUCTION_SIGNUP_OVERRIDE_ENV = "ALLOW_PRODUCTION_SIGNUP_SMOKE";
export const STRIPE_CLEANUP_MAX_ATTEMPTS = 3;

export interface SmokeTargetEnv {
  stripeKey?: string;
  supabaseUrl?: string;
  override?: string;
}

/**
 * Conservative by design: anything that is not clearly a local stack counts
 * as Production. A live-mode Stripe key alone is decisive, because that is
 * where real customers and subscriptions are created.
 */
export function isProductionTarget(env: SmokeTargetEnv): boolean {
  if ((env.stripeKey ?? "").startsWith("sk_live_")) return true;

  const url = env.supabaseUrl ?? "";
  if (!url) return true;
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(url);
}

export function isProductionSignupOverrideSet(override: string | undefined): boolean {
  return override === "true";
}

/**
 * Throws unless it is safe to create a throwaway account here.
 *
 * Refusal is the default and it is loud. Skipping silently would let a run
 * look green while the accounts it should have exercised were never created,
 * which is how the leak went unnoticed in the first place.
 */
export function assertFreshAccountSignupAllowed(env: SmokeTargetEnv): void {
  if (!isProductionTarget(env)) return;
  if (isProductionSignupOverrideSet(env.override)) return;

  throw new Error(
    [
      "Refusing to create a fresh signup account against Production.",
      "",
      "This helper creates a real Supabase Auth user, a real tpe_businesses row,",
      "a real Stripe Customer, and a real trial Subscription. A previous run",
      "leaked 19 live Stripe customers this way.",
      "",
      `Set ${PRODUCTION_SIGNUP_OVERRIDE_ENV}=true for that one run if you genuinely`,
      "intend to create and then delete real Production records, and verify",
      "afterwards that no Stripe Customer survived.",
    ].join("\n")
  );
}

// ── Stripe cleanup classification ────────────────────────────────────────────

function errorFields(error: unknown): { code?: unknown; type?: unknown; statusCode?: unknown; message?: unknown } {
  if (!error || typeof error !== "object") return {};
  return error as { code?: unknown; type?: unknown; statusCode?: unknown; message?: unknown };
}

/** The only tolerated outcome: the customer is already gone. */
export function isMissingStripeCustomerError(error: unknown): boolean {
  const e = errorFields(error);
  return (
    e.code === "resource_missing" ||
    e.statusCode === 404 ||
    (typeof e.message === "string" && /no such customer/i.test(e.message))
  );
}

/** Worth one more attempt: rate limits, lock contention, Stripe-side faults. */
export function isTransientStripeError(error: unknown): boolean {
  const e = errorFields(error);
  if (e.code === "rate_limit" || e.code === "lock_timeout") return true;
  if (e.type === "rate_limit_error" || e.type === "api_error" || e.type === "api_connection_error") return true;
  if (typeof e.statusCode === "number" && (e.statusCode === 429 || e.statusCode >= 500)) return true;
  return false;
}

export type StripeCleanupOutcome = "deleted" | "already-gone";

/**
 * Deletes a Stripe customer for test teardown, retrying only transient
 * failures. Anything else throws with the customer id in the message, so the
 * caller stops before removing the database and Auth rows that are the only
 * remaining record of it.
 */
export async function deleteStripeCustomerForTest(
  deleteCustomer: (customerId: string) => Promise<unknown>,
  customerId: string,
  options: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<StripeCleanupOutcome> {
  const attempts = options.attempts ?? STRIPE_CLEANUP_MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deleteCustomer(customerId);
      return "deleted";
    } catch (error) {
      if (isMissingStripeCustomerError(error)) return "already-gone";
      lastError = error;
      if (!isTransientStripeError(error)) break;
      if (attempt < attempts) await sleep(200 * attempt);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    [
      `Stripe cleanup failed for customer ${customerId} after ${attempts} attempt(s): ${detail}`,
      "",
      "Test teardown stopped before deleting the database and Auth rows. Those",
      "rows are the only record tying this customer to a user, so removing them",
      "now would leave an unattributable live customer and trial in Stripe.",
      `Delete ${customerId} manually, then re-run.`,
    ].join("\n")
  );
}
