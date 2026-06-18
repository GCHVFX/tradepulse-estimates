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

  let body: { invoice_amount?: unknown; due_date?: unknown };
  try {
    body = (await request.json()) as { invoice_amount?: unknown; due_date?: unknown };
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const amount = typeof body.invoice_amount === "number"
    ? body.invoice_amount
    : typeof body.invoice_amount === "string"
      ? Number(body.invoice_amount)
      : NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    return applyTo(NextResponse.json({ error: "Invoice amount must be a positive number" }, { status: 400 }));
  }

  if (typeof body.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) {
    return applyTo(NextResponse.json({ error: "Due date is required" }, { status: 400 }));
  }

  const [year, month, day] = body.due_date.split("-").map(Number);
  const dueUtc = Date.UTC(year, month - 1, day);
  if (Number.isNaN(dueUtc)) {
    return applyTo(NextResponse.json({ error: "Due date is not a valid date" }, { status: 400 }));
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (dueUtc < todayUtc) {
    return applyTo(NextResponse.json({ error: "Due date must be today or later" }, { status: 400 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
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
    .update({
      invoice_amount: amount,
      due_date: body.due_date,
      payment_status: "unpaid",
      reminder_count: 0,
      last_reminder_sent_at: null,
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
