import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { id } = await params;

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id")
    .eq("id", id)
    .eq("business_id", user.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("tpe_estimates")
    .update({
      payment_status: "paid",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("business_id", user.id)
    .select("*")
    .maybeSingle();

  if (updateError || !updated) {
    return applyTo(NextResponse.json({ error: updateError?.message ?? "Update failed" }, { status: 500 }));
  }

  return applyTo(NextResponse.json({ estimate: updated }));
}
