import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, title, status, customer_name, created_at")
    .eq("business_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ estimates: data ?? [] }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  let body: {
    id?: unknown;
    customer_name?: unknown;
    customer_phone?: unknown;
    customer_address?: unknown;
    customer_email?: unknown;
    deposit_amount?: unknown;
    summary?: unknown;
    status?: unknown;
    completed_at?: unknown;
    copied_at?: unknown;
    include_photos?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  if (typeof body.id !== "string") {
    return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));
  }

  // Only include fields present in the body — never overwrite with defaults
  const updateFields: Record<string, unknown> = {};

  if ("customer_name" in body) {
    updateFields.customer_name = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  }
  if ("customer_phone" in body) {
    updateFields.customer_phone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
  }
  if ("customer_address" in body) {
    updateFields.customer_address = typeof body.customer_address === "string" ? body.customer_address.trim() : "";
  }
  if ("customer_email" in body) {
    updateFields.customer_email = typeof body.customer_email === "string" ? body.customer_email.trim() : "";
  }
  if ("deposit_amount" in body) {
    updateFields.deposit_amount = typeof body.deposit_amount === "string" ? body.deposit_amount.trim() || null : null;
  }
  if ("summary" in body) {
    updateFields.summary = typeof body.summary === "string" ? body.summary.trim() : undefined;
  }
  if ("status" in body && typeof body.status === "string") {
    updateFields.status = body.status;
  }
  if ("completed_at" in body) {
    updateFields.completed_at = typeof body.completed_at === "string" ? body.completed_at : null;
  }
  if ("copied_at" in body) {
    updateFields.copied_at = typeof body.copied_at === "string" ? body.copied_at : null;
  }
  if ("include_photos" in body) {
    updateFields.include_photos = body.include_photos === true;
  }

  if (Object.keys(updateFields).length === 0) {
    return applyTo(NextResponse.json({ error: "No fields to update" }, { status: 400 }));
  }

  const { data: updated, error } = await supabaseAdmin
    .from("tpe_estimates")
    .update(updateFields)
    .eq("id", body.id)
    .eq("business_id", user.id)
    .select("id");

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  if (!updated || updated.length === 0) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  return applyTo(NextResponse.json({ success: true }));
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));

  const { error } = await supabaseAdmin
    .from("tpe_estimates")
    .delete()
    .eq("id", id)
    .eq("business_id", user.id);

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  // Best-effort: remove any attached photos so they don't outlive the estimate.
  const folder = `${user.id}/${id}`;
  const { data: files } = await supabaseAdmin.storage.from("estimate-photos").list(folder);
  if (files && files.length > 0) {
    await supabaseAdmin.storage
      .from("estimate-photos")
      .remove(files.map((f) => `${folder}/${f.name}`));
  }

  return applyTo(NextResponse.json({ success: true }));
}
