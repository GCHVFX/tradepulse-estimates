import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));

  const { data, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, title, status, customer_name, created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ estimates: data ?? [] }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));

  let body: {
    id?: unknown;
    title?: unknown;
    customer_name?: unknown;
    customer_phone?: unknown;
    job_address?: unknown;
    customer_email?: unknown;
    deposit_amount?: unknown;
    summary?: unknown;
    status?: unknown;
    completed_at?: unknown;
    copied_at?: unknown;
    include_photos?: unknown;
    structured_items?: unknown;
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

  if ("title" in body) {
    updateFields.title = typeof body.title === "string" ? body.title.trim() : null;
  }
  if ("customer_name" in body) {
    updateFields.customer_name = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  }
  if ("customer_phone" in body) {
    updateFields.customer_phone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
  }
  if ("job_address" in body) {
    updateFields.job_address = typeof body.job_address === "string" ? body.job_address.trim() : "";
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

  type StructuredItemUpdate = {
    description: string;
    quantity: number;
    unit: string | null;
    unit_price: number;
    line_total: number;
    display_order: number;
  };
  let structuredItems: StructuredItemUpdate[] | null = null;
  if ("structured_items" in body) {
    if (!Array.isArray(body.structured_items)) {
      return applyTo(NextResponse.json({ error: "structured_items must be an array" }, { status: 400 }));
    }
    const parsedItems: Array<StructuredItemUpdate | null> = body.structured_items.map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      if (
        typeof value.description !== "string" ||
        typeof value.quantity !== "number" || !Number.isFinite(value.quantity) ||
        (value.unit !== null && typeof value.unit !== "string") ||
        typeof value.unit_price !== "number" || !Number.isFinite(value.unit_price) ||
        typeof value.line_total !== "number" || !Number.isFinite(value.line_total) ||
        typeof value.display_order !== "number" || !Number.isInteger(value.display_order) || value.display_order < 0
      ) return null;
      return {
        description: value.description.trim(),
        quantity: value.quantity,
        unit: value.unit,
        unit_price: value.unit_price,
        line_total: value.line_total,
        display_order: value.display_order,
      };
    });
    if (parsedItems.some((item) => item === null)) {
      return applyTo(NextResponse.json({ error: "Invalid structured item" }, { status: 400 }));
    }
    structuredItems = parsedItems.filter((item): item is StructuredItemUpdate => item !== null);
  }

  if (Object.keys(updateFields).length === 0) {
    return applyTo(NextResponse.json({ error: "No fields to update" }, { status: 400 }));
  }

  const { data: updated, error } = await supabaseAdmin
    .from("tpe_estimates")
    .update(updateFields)
    .eq("id", body.id)
    .eq("business_id", business.id)
    .select("id");

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  if (!updated || updated.length === 0) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  if (structuredItems) {
    for (const item of structuredItems) {
      const { error: itemError } = await supabaseAdmin
        .from("tpe_estimate_items")
        .update({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          line_total: item.line_total,
        })
        .eq("estimate_id", body.id)
        .eq("display_order", item.display_order);
      if (itemError) return applyTo(NextResponse.json({ error: itemError.message }, { status: 500 }));
    }
  }

  return applyTo(NextResponse.json({ success: true }));
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));

  // tpe_estimate_changes, tpe_estimate_photos, and tpe_payment_reminders all
  // reference tpe_estimates with delete_rule NO ACTION (not CASCADE), so the
  // parent delete below fails with a foreign key violation whenever any of
  // them has a row for this estimate — which happens for any estimate that
  // was ever sent, invoiced, or had a photo attached. Remove those children
  // first so the parent delete can actually succeed.
  const { data: photoRecords } = await supabaseAdmin
    .from("tpe_estimate_photos")
    .select("id, storage_path")
    .eq("estimate_id", id);

  if (photoRecords && photoRecords.length > 0) {
    await supabaseAdmin.storage
      .from("tpe-estimate-photos")
      .remove(photoRecords.map((p) => p.storage_path));
    await supabaseAdmin
      .from("tpe_estimate_photos")
      .delete()
      .eq("estimate_id", id);
  }

  await supabaseAdmin.from("tpe_estimate_changes").delete().eq("estimate_id", id);
  await supabaseAdmin.from("tpe_payment_reminders").delete().eq("estimate_id", id);

  const { error } = await supabaseAdmin
    .from("tpe_estimates")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  return applyTo(NextResponse.json({ success: true }));
}
