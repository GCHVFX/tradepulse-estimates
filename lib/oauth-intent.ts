/**
 * Binds a Google OAuth round trip to the action the person actually started.
 *
 * The intent cannot travel as a plain callback query parameter: anyone can
 * craft `/auth/callback?intent=signup` and reach the provisioning branch. It
 * is instead written to a short-lived HttpOnly cookie when the flow starts,
 * and paired with a nonce that also travels in the `redirectTo` URL. The
 * callback only trusts an intent when the cookie is present, its value is on
 * the allowlist, it has not expired, and its nonce matches the one that came
 * back with the redirect.
 *
 * Anything else (missing, malformed, unknown value, expired, or a nonce that
 * does not match) resolves to null, and the caller fails closed.
 */

export const OAUTH_INTENTS = ["login", "signup"] as const;
export type OAuthIntent = (typeof OAUTH_INTENTS)[number];

export const OAUTH_INTENT_COOKIE = "tp_oauth_intent";
export const OAUTH_INTENT_MAX_AGE_SECONDS = 600;
/** Query parameter carrying the nonce back from the provider. */
export const OAUTH_NONCE_PARAM = "s";

/** Strict allowlist. Never widen this to accept arbitrary caller input. */
export function parseOAuthIntent(value: unknown): OAuthIntent | null {
  if (typeof value !== "string") return null;
  return (OAUTH_INTENTS as readonly string[]).includes(value) ? (value as OAuthIntent) : null;
}

export function createOAuthNonce(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

export function serializeOAuthIntentCookie(intent: OAuthIntent, nonce: string, now = Date.now()): string {
  return `${intent}.${nonce}.${now}`;
}

/**
 * Resolves the intent only when every check passes. `null` means the caller
 * must sign the person out and send them somewhere safe.
 */
export function resolveOAuthIntent(
  cookieValue: string | undefined | null,
  nonceFromCallback: string | undefined | null,
  now = Date.now()
): OAuthIntent | null {
  if (typeof cookieValue !== "string" || !cookieValue) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;

  const [rawIntent, cookieNonce, rawIssuedAt] = parts;

  const intent = parseOAuthIntent(rawIntent);
  if (!intent) return null;

  if (!cookieNonce || typeof nonceFromCallback !== "string" || !nonceFromCallback) return null;
  if (cookieNonce.length !== nonceFromCallback.length) return null;
  if (cookieNonce !== nonceFromCallback) return null;

  const issuedAt = Number(rawIssuedAt);
  if (!Number.isFinite(issuedAt)) return null;
  // A cookie issued in the future is as suspect as an expired one.
  if (issuedAt > now) return null;
  if (now - issuedAt > OAUTH_INTENT_MAX_AGE_SECONDS * 1000) return null;

  return intent;
}
