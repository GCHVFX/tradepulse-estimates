import { normalizePhoneE164, type SmsSuppressionStore } from "@/lib/sms-suppression";

export type TwilioOptOutKind = "STOP" | "START" | "HELP";

// Twilio's Advanced Opt-Out feature adds an `OptOutType` field to the normal
// inbound-message webhook whenever the message body matches a recognized
// keyword, so that field is the primary signal. The keyword lists below are
// Twilio's own documented default keyword set and are used as a fallback so
// this handler behaves correctly even before Advanced Opt-Out is turned on
// in the Console (see the report for what still needs verifying there) --
// without them, STOP would only work once that Console setting is confirmed.
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

export function classifyOptOut(params: Record<string, string>): TwilioOptOutKind | null {
  const optOutType = (params.OptOutType ?? "").trim().toUpperCase();
  if (optOutType === "STOP") return "STOP";
  if (optOutType === "START") return "START";
  if (optOutType === "HELP") return "HELP";

  const body = (params.Body ?? "").trim().toUpperCase();
  if (!body) return null;
  if (STOP_KEYWORDS.has(body)) return "STOP";
  if (START_KEYWORDS.has(body)) return "START";
  if (HELP_KEYWORDS.has(body)) return "HELP";
  return null;
}

export interface TwilioInboundDependencies {
  /** `twilio.validateRequest` from the official `twilio` package. */
  validateSignature: (authToken: string, signature: string, url: string, params: Record<string, string>) => boolean;
  getAuthToken: () => string | undefined;
  /**
   * The exact public URL Twilio is configured to POST this webhook to.
   * Twilio's signature covers this URL, so it must match Console
   * configuration exactly (protocol, host, path -- no trailing differences).
   */
  getWebhookUrl: () => string;
  store: SmsSuppressionStore;
}

function twiml(): Response {
  // Twilio accepts an empty TwiML response for a webhook that doesn't need
  // to reply -- Advanced Opt-Out already sends its own STOP/START/HELP
  // confirmation text, so this app must not send a second one.
  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export function createTwilioInboundWebhookHandler(
  dependencies: TwilioInboundDependencies
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const rawBody = await request.text();
    const signature = request.headers.get("x-twilio-signature");

    if (!signature) return new Response("Missing signature", { status: 400 });

    const authToken = dependencies.getAuthToken();
    if (!authToken) return new Response("Webhook not configured", { status: 500 });

    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());

    const valid = dependencies.validateSignature(
      authToken,
      signature,
      dependencies.getWebhookUrl(),
      params
    );
    if (!valid) return new Response("Invalid signature", { status: 403 });

    const from = params.From;
    const messageSid = params.MessageSid ?? null;
    const kind = classifyOptOut(params);

    // No recipient number, or a normal inbound text that isn't an opt-out
    // keyword: nothing to record. This is the common case -- most inbound
    // messages are not STOP/START/HELP -- and it must leave suppression
    // state untouched.
    if (!from || !kind) return twiml();

    const phone = normalizePhoneE164(from) ?? from;

    try {
      if (kind === "STOP") {
        await dependencies.store.suppress({ phone, messageSid });
      } else if (kind === "START") {
        await dependencies.store.unsuppress({ phone, messageSid });
      }
      // HELP: Twilio's own Advanced Opt-Out reply already answers it. Local
      // state is unaffected either way, so this is an intentional no-op
      // branch rather than a fallthrough.
    } catch (error) {
      console.error(
        "[twilio-inbound-webhook] processing failed:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return new Response("Processing failed", { status: 500 });
    }

    return twiml();
  };
}
