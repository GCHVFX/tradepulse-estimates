import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { buildStructuredItemsSyncPlan } from "@/lib/estimate-item-migration";
import { deleteOwnedEstimate } from "@/lib/estimate-deletion";
import { classifyEstimate } from "@/lib/estimate-classification";
import { isDelivered, wouldNewlyDeliver, wouldNewlyUndeliver, type EstimateDeliveryPatch } from "@/lib/estimate-delivery";
import { contractorPricingCompleteness } from "@/lib/estimate-pricing-server";

/**
 * Customer-visible fields this route can write. Once a contractor_pricing
 * estimate is delivered they are locked (specs/contractor-owned-pricing.md
 * section 12): the customer already holds a document built from these, and a
 * later edit here would silently rewrite it without the customer ever
 * knowing. `status`, `completed_at`, `deposit_amount` and `copied_at` are
 * deliberately absent -- operational progression, and re-copying an already
 * delivered link, stay allowed.
 */
const LOCKED_CUSTOMER_FIELDS = [
  "title",
  "summary",
  "customer_name",
  "customer_phone",
  "customer_email",
  "job_address",
  "include_photos",
] as const;

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

  // Loaded once, up front, for every PATCH: classification and delivery
  // gating both need it before a single field is written
  // (specs/contractor-owned-pricing.md sections 12 and 13).
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("tpe_estimates")
    .select(
      "id, pricing_source, source, status, sent_at, copied_at, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot"
    )
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (lookupError) return applyTo(NextResponse.json({ error: lookupError.message }, { status: 500 }));
  if (!existing) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
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

  if (Object.keys(updateFields).length === 0) {
    return applyTo(NextResponse.json({ error: "No fields to update" }, { status: 400 }));
  }

  // Classification first, before completeness or lock decisions
  // (specs/contractor-owned-pricing.md section 2). Legacy and unpriced
  // inbound intake never run contractor-pricing completeness or lock logic.
  const pricingClass = classifyEstimate(existing);

  if (pricingClass === "contractor_pricing") {
    // copied_at only ever moves from null to a timestamp. Accepting a null
    // here would let a caller clear the one field that, on a draft with no
    // sent_at, is the entire delivered signal -- a real un-deliver path, not
    // just an unused one.
    if ("copied_at" in updateFields && updateFields.copied_at === null) {
      return applyTo(NextResponse.json({ error: "copied_at cannot be cleared" }, { status: 400 }));
    }

    // Built once and shared by both branches below: the only two
    // delivery-relevant fields this route can ever write. sent_at cannot be
    // patched through this route at all -- there is no `if ("sent_at" in
    // body)` handling anywhere above -- so it is never part of this patch
    // and always keeps its existing value.
    const deliveryPatch: EstimateDeliveryPatch = {};
    if ("status" in updateFields) deliveryPatch.status = updateFields.status as string;
    if ("copied_at" in updateFields) deliveryPatch.copied_at = updateFields.copied_at as string | null;

    if (isDelivered(existing)) {
      // Locked once delivered: the customer already holds a document built
      // from these fields, and this route must never quietly rewrite it.
      const lockedFieldsTouched = LOCKED_CUSTOMER_FIELDS.filter((field) => field in updateFields);
      if (lockedFieldsTouched.length > 0) {
        return applyTo(
          NextResponse.json(
            { error: "This estimate has already gone to the customer and its details cannot be changed" },
            { status: 409 }
          )
        );
      }

      // A delivered estimate must never become undelivered through this
      // route. status is deliberately not in LOCKED_CUSTOMER_FIELDS above
      // (sent -> done has to stay possible), but that same freedom would let
      // a PATCH move status away from "sent"/"done" entirely while sent_at
      // and copied_at stay null -- flipping isDelivered() back to false and
      // silently reopening the pricing route, the photo routes and
      // regenerate, all of which gate on that same predicate for this
      // estimate. wouldNewlyUndeliver() checks this with the shared
      // predicate, not an enumeration of which status values still count as
      // delivered.
      if (wouldNewlyUndeliver(existing, deliveryPatch)) {
        return applyTo(
          NextResponse.json(
            { error: "This estimate has already gone to the customer and cannot be marked undelivered" },
            { status: 409 }
          )
        );
      }
    } else {
      // A first-delivery transition through this route: anything that would
      // flip isDelivered() from false to true -- status: "sent", status:
      // "done" taken directly, or copied_at being written for the first
      // time -- must pass the same completeness gate as SMS and email
      // (specs/contractor-owned-pricing.md section 13). wouldNewlyDeliver()
      // re-runs the one shared isDelivered() predicate against the patched
      // fields rather than enumerating specific values, so a direct
      // draft -> status: "done" PATCH cannot skip this check the way a
      // status === "sent" comparison alone would.
      if (wouldNewlyDeliver(existing, deliveryPatch)) {
        const pricing = await contractorPricingCompleteness(estimateId, existing);
        if (!pricing.complete) {
          return applyTo(
            NextResponse.json(
              { error: "This estimate is missing pricing information and cannot be sent yet" },
              { status: 409 }
            )
          );
        }
      }
    }
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

  // Ownership first: nothing below runs until the estimate is found under this
  // caller's business, and every child deletion uses that authorized estimate's
  // id. See lib/estimate-deletion.ts for why the order is the security fix.
  const result = await deleteOwnedEstimate(id, business.id, {
    findOwnedEstimate: async (estimateId, businessId) => {
      const { data, error } = await supabaseAdmin
        .from("tpe_estimates")
        .select("id")
        .eq("id", estimateId)
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    listPhotoStoragePaths: async (estimateId) => {
      const { data } = await supabaseAdmin
        .from("tpe_estimate_photos")
        .select("storage_path")
        .eq("estimate_id", estimateId);
      return (data ?? []).map((photo) => photo.storage_path);
    },
    removePhotoObjects: async (storagePaths) => {
      await supabaseAdmin.storage.from("tpe-estimate-photos").remove(storagePaths);
    },
    deletePhotoRows: async (estimateId) => {
      await supabaseAdmin.from("tpe_estimate_photos").delete().eq("estimate_id", estimateId);
    },
    deleteEstimateChanges: async (estimateId) => {
      await supabaseAdmin.from("tpe_estimate_changes").delete().eq("estimate_id", estimateId);
    },
    deletePaymentReminders: async (estimateId) => {
      await supabaseAdmin.from("tpe_payment_reminders").delete().eq("estimate_id", estimateId);
    },
    deleteEstimate: async (estimateId, businessId) => {
      const { error } = await supabaseAdmin
        .from("tpe_estimates")
        .delete()
        .eq("id", estimateId)
        .eq("business_id", businessId);
      return error ? error.message : null;
    },
  });

  if (!result.ok) {
    return applyTo(NextResponse.json({ error: result.error }, { status: result.status }));
  }

  return applyTo(NextResponse.json({ success: true }));
}
