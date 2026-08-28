import twilio from "twilio";
import { supabaseAdmin } from "@/lib/supabase-server";
import { createSupabaseSmsSuppressionStore } from "@/lib/sms-suppression";
import { createTwilioInboundWebhookHandler } from "@/lib/twilio-inbound-webhook";
import { SITE_URL } from "@/lib/site-url";

export const POST = createTwilioInboundWebhookHandler({
  validateSignature: twilio.validateRequest,
  getAuthToken: () => process.env.TWILIO_AUTH_TOKEN,
  // Twilio signs against the exact URL it was configured to POST to. This
  // app sends every SMS from one shared number (see lib/sms-suppression.ts),
  // so there is one fixed webhook URL, not a per-business one.
  getWebhookUrl: () =>
    `${SITE_URL}/api/webhooks/twilio-inbound`,
  store: createSupabaseSmsSuppressionStore(supabaseAdmin),
});
