import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { buildStructuredItemsSyncPlan } from "@/lib/estimate-item-migration";

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
  };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  if (typeof body.id !== "string") {
    return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));
  }
  // A separate const, not body.id directly: body is declared with `let`, so
  // TypeScript does not carry the narrowing above into a closure (the map()
  // below) that reads body.id.
  const estimateId = body.id;

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

  if (Object.keys(updateFields).length === 0) {
    return applyTo(NextResponse.json({ error: "No fields to update" }, { status: 400 }));
  }

  // A summary update on a structured estimate must keep tpe_estimate_items in
  // sync with the exact same edit, as part of the same save. It used to be
  // synced by a client-computed, partial per-row UPDATE matched by
  // display_order — which never inserted a row for an added line item and
  // never deleted a row for a removed one, leaving stale rows behind after a
  // delete and silently dropping additions. Structured items are now
  // regenerated wholesale from the markdown actually being saved, through the
  // same parse/convert pipeline generation already uses (parseSummary ->
  // parsedToItems -> draftToItemRow), so the two representations cannot
  // drift: there is only one input for both.
  const isSummaryUpdate = typeof updateFields.summary === "string";

  if (isSummaryUpdate) {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("tpe_estimates")
      .select("id, pricing_source")
      .eq("id", estimateId)
      .eq("business_id", business.id)
      .maybeSingle();

    if (lookupError) return applyTo(NextResponse.json({ error: lookupError.message }, { status: 500 }));
    if (!existing) {
      return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
    }

    if (existing.pricing_source === "structured") {
      const plan = buildStructuredItemsSyncPlan(updateFields.summary as string, estimateId);

      if (!plan.subtotalsMatch) {
        console.error("[api/estimates] structured/markdown subtotal mismatch while saving, refusing", {
          estimateId,
          markdownSubtotal: plan.markdownSubtotal,
          structuredSubtotal: plan.structuredSubtotal,
        });
        return applyTo(
          NextResponse.json({ error: "Could not save: pricing did not compute consistently" }, { status: 500 })
        );
      }

      // Replace, don't reconcile: deleting every existing row before
      // inserting the freshly computed set is what guarantees no row from a
      // deleted line item, and no missing row for an added one, can survive
      // this save. This runs before the estimate row itself is touched, so a
      // failure here leaves the estimate exactly as it was — old summary,
      // old items, still mutually consistent — rather than a half-applied
      // edit. (Supabase's REST API cannot span this delete/insert and the
      // update below in one transaction; sequencing the riskier multi-row
      // step first, before anything is written to tpe_estimates, is the
      // smallest available way to keep a failure here from ever landing a
      // half-applied edit. See HANDOFF.md for the residual, much narrower
      // risk this does not eliminate.)
      const { error: deleteError } = await supabaseAdmin
        .from("tpe_estimate_items")
        .delete()
        .eq("estimate_id", estimateId);
      if (deleteError) return applyTo(NextResponse.json({ error: deleteError.message }, { status: 500 }));

      if (plan.rows.length > 0) {
        const { error: insertError } = await supabaseAdmin.from("tpe_estimate_items").insert(plan.rows);
        if (insertError) return applyTo(NextResponse.json({ error: insertError.message }, { status: 500 }));
      }
    }
  }

  const { data: updated, error } = await supabaseAdmin
    .from("tpe_estimates")
    .update(updateFields)
    .eq("id", estimateId)
    .eq("business_id", business.id)
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
