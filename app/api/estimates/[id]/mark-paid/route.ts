import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { hasProPaymentsAccess } from "@/lib/auth";
import { SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await params;

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select(`id, ${SUBSCRIPTION_ACCESS_COLUMNS}`)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  }

  // Payments is Pro-only. The UI never surfaces this action to Starter, but
  // the UI is not the gate: this route is reachable directly.
  if (!hasProPaymentsAccess(business)) {
    return applyTo(NextResponse.json({ error: "Pro plan required" }, { status: 403 }));
  }

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tpe_estimates")
    // Payment state only. `completed_at` means "the job was marked done" and
    // is owned by Mark Job Done (PATCH /api/estimates with status: 'done').
    // Writing it here overwrote that timestamp, and on an estimate that was
    // never marked done it invented a job-completion time that never
    // happened. /estimates renders completed_at as the job-done date, so both
    // cases showed the customer-facing list a wrong date.
    .update({
      payment_status: "paid",
    })
    .eq("id", id)
    .eq("business_id", business.id)
    .select("*")
    .maybeSingle();

  if (updateError || !updated) {
    return applyTo(NextResponse.json({ error: updateError?.message ?? "Update failed" }, { status: 500 }));
  }

  return applyTo(NextResponse.json({ estimate: updated }));
}
