/**
 * How a Twilio SMS send addresses itself: messagingServiceSid when
 * configured, otherwise the bare `from` number. Twilio rejects a request
 * that supplies both, so this is strictly either/or.
 *
 * Sending via the Messaging Service (rather than a bare `from` number)
 * matters beyond delivery: the service's Advanced Opt-Out management only
 * governs sends made through it, and the number's 10DLC campaign
 * registration is tied to the service, not to an ad-hoc `from` send.
 */
export interface TwilioSendAddress {
  messagingServiceSid: string;
  from?: undefined;
}

export interface TwilioSendAddressFallback {
  messagingServiceSid?: undefined;
  from: string | undefined;
}

/**
 * Resolves which address fields to spread into `client.messages.create()`.
 * Blank-checked (trim + truthy), not nullish-checked, so an env var recorded
 * as `""` in Vercel is treated the same as unset -- the same convention
 * `lib/site-url.ts`'s `cleanEnv` uses, for the same reason: an empty string
 * is not nullish, so a `??`/optional-chain-only check would silently hand
 * Twilio a blank `messagingServiceSid`.
 */
export function resolveTwilioSendAddress(
  env: Record<string, string | undefined>
): TwilioSendAddress | TwilioSendAddressFallback {
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (messagingServiceSid) return { messagingServiceSid };
  return { from: env.TWILIO_FROM_NUMBER };
}

/**
 * Whether a usable Twilio sender is configured at all -- either
 * TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER, blank-checked like
 * everything else in this file. Every route's "is SMS configured" gate
 * should call this instead of checking TWILIO_FROM_NUMBER directly:
 * resolveTwilioSendAddress() no longer requires TWILIO_FROM_NUMBER once a
 * Messaging Service SID is set, so a gate that still hard-requires it would
 * silently stop sending (no error, nothing in logs) the moment
 * TWILIO_FROM_NUMBER is retired from an environment that only has the SID.
 *
 * Derived from resolveTwilioSendAddress()'s own return value, not a second
 * copy of the blank-check, so the two can never disagree about what counts
 * as "configured."
 */
export function hasUsableTwilioSender(env: Record<string, string | undefined>): boolean {
  const address = resolveTwilioSendAddress(env);
  if (address.messagingServiceSid) return true;
  return Boolean(address.from?.trim());
}
