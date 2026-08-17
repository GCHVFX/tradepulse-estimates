import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type DeliveryChannel = "sms" | "email";

interface DeliveryClaimInput {
  businessId: string;
  estimateId: string;
  channel: DeliveryChannel;
  recipient: string;
  action: string;
  stage: string;
}

export async function claimDelivery(
  supabaseAdmin: SupabaseClient<Database>,
  input: DeliveryClaimInput
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_delivery", {
    p_business_id: input.businessId,
    p_estimate_id: input.estimateId,
    p_channel: input.channel,
    p_recipient: input.recipient,
    p_action: input.action,
    p_stage: input.stage,
  });

  if (error) throw new Error("Unable to record delivery claim");
  const claim = data?.[0];
  return claim?.claimed ? claim.claim_id : null;
}

export async function markDeliverySent(
  supabaseAdmin: SupabaseClient<Database>,
  claimId: string
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("mark_delivery_sent", { p_claim_id: claimId });
  if (error) console.error("[delivery-claims] unable to mark delivery sent:", error.message);
}
