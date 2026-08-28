import twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createSupabaseSmsSuppressionStore } from "@/lib/sms-suppression";
import { createTwilioInboundWebhookHandler } from "@/lib/twilio-inbound-webhook";
import { TWILIO_SIGNATURE_HOSTS } from "@/lib/site-url";

export const POST = createTwilioInboundWebhookHandler({
  validateSignature: twilio.validateRequest,
  getAuthToken: () => process.env.TWILIO_AUTH_TOKEN,
  // Twilio signs against the exact URL it was configured to POST to in
  // Console, which doesn't have to agree with SITE_URL. This app sends
  // every SMS from one shared number (see lib/sms-suppression.ts), so the
  // path is fixed; the host is whichever alias TWILIO_SIGNATURE_HOSTS
  // lists, tried in turn.
  getWebhookUrls: () =>
    TWILIO_SIGNATURE_HOSTS.map((host) => `https://${host}/api/webhooks/twilio-inbound`),
  store: createSupabaseSmsSuppressionStore(supabaseAdmin),
});
