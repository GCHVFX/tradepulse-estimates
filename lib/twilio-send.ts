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
