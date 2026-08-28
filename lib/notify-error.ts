import { Resend } from "resend";
import { checkRateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase-server";
import { ESTIMATES_EMAIL, SUPPORT_EMAIL } from "@/lib/email-addresses";

export async function notifyInternalError(input: {
  context: string;
  status: number;
  error: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  try {
    const rateLimit = await checkRateLimit(supabaseAdmin, input.context, "internal-error-notify", 3, 60);
    if (!rateLimit.allowed) return;

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: ESTIMATES_EMAIL,
      to: SUPPORT_EMAIL,
      subject: `[TradePulse Alert] ${input.context.slice(0, 80)} failed with ${input.status}`,
      text: [
        `Context: ${input.context.slice(0, 200)}`,
        `Status: ${input.status}`,
        `Error: ${input.error.slice(0, 2000)}`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("[notify-error] internal notification failed:", error instanceof Error ? error.message : error);
  }
}
