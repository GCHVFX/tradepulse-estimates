import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { validateContentType } from "@/lib/api-utils";
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";
import { isDelivered } from "@/lib/estimate-delivery";
import {
  firstHourlyRateCandidate,
  parseContractorPricingRequest,
  toCanonicalRows,
} from "@/lib/contractor-pricing-request";
import {
  calculateContractorPricing,
  type PricingRow,
  type PricingSnapshots,
} from "@/lib/contractor-pricing";

/**
 * The one authoritative contractor-pricing write path
 * (specs/contractor-owned-pricing.md section 12).
 *
 * PUT, not PATCH: the body is the estimate's whole current pricing state, and
 * the save replaces every row. An incomplete draft saves happily; completeness
 * is reported here and enforced at delivery, in a later slice.
 *
 * One persistence call. Row replacement, inbound-quote promotion, snapshot
 * copies and the permitted business-default writes all happen inside
 * tpe_save_contractor_pricing, which re-checks ownership and delivery under a
 * row lock, so a race with a send cannot mutate a delivered estimate.
 */

/** What the save transaction returns. Narrowed by hand from its jsonb. */
interface SavedPricingState {
  estimate_id: string;
  status: string;
  pricing_source: string;
  promoted: boolean;
  tax_label_snapshot: string | null;
  tax_rate_snapshot: number | null;
  deposit_percent_snapshot: number | null;
  deposit_threshold_snapshot: number | null;
  business_labour_rate: number | null;
  rows: Array<{
    item_type: string;
    unit: string | null;
    quantity: number;
    unit_price: number;
    markup_percent: number | null;
    description: string;
    display_order: number;
  }>;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function narrowSavedState(data: unknown): SavedPricingState | null {
  if (typeof data !== "object" || data === null) return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.estimate_id !== "string" || !Array.isArray(raw.rows)) return null;

  return {
    estimate_id: raw.estimate_id,
    status: String(raw.status ?? ""),
    pricing_source: String(raw.pricing_source ?? ""),
    promoted: raw.promoted === true,
    tax_label_snapshot: typeof raw.tax_label_snapshot === "string" ? raw.tax_label_snapshot : null,
    tax_rate_snapshot: toNumberOrNull(raw.tax_rate_snapshot),
    deposit_percent_snapshot: toNumberOrNull(raw.deposit_percent_snapshot),
    deposit_threshold_snapshot: toNumberOrNull(raw.deposit_threshold_snapshot),
    business_labour_rate: toNumberOrNull(raw.business_labour_rate),
    rows: raw.rows.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        item_type: String(item.item_type ?? ""),
        unit: typeof item.unit === "string" ? item.unit : null,
        quantity: toNumberOrNull(item.quantity) ?? 0,
        unit_price: toNumberOrNull(item.unit_price) ?? 0,
        markup_percent: toNumberOrNull(item.markup_percent),
        description: String(item.description ?? ""),
        display_order: toNumberOrNull(item.display_order) ?? 0,
      };
    }),
  };
}

/** Database refusals, mapped to the response each one deserves. */
function statusForDatabaseError(message: string): { status: number; error: string } {
  if (message.includes("ESTIMATE_DELIVERED")) {
    return { status: 409, error: "This estimate has already gone to the customer and cannot be repriced" };
  }
  if (message.includes("ESTIMATE_NOT_FOUND_OR_NOT_OWNED")) {
    return { status: 404, error: "Estimate not found or access denied" };
  }
  if (message.includes("ESTIMATE_NOT_CONTRACTOR_PRICING")) {
    return { status: 409, error: "This estimate uses the previous pricing system and is read-only" };
  }
  return { status: 500, error: "Could not save pricing" };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

  const { id } = await params;

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select(`id, ${SUBSCRIPTION_ACCESS_COLUMNS}`)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!hasSubscriptionAccess(business)) {
    return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));
  }

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id, status, sent_at, copied_at")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
  }

  // Checked here for a clear early answer, and again inside the transaction,
  // which is the check that actually holds against a concurrent send.
  if (isDelivered(estimate)) {
    return applyTo(
      NextResponse.json(
        { error: "This estimate has already gone to the customer and cannot be repriced" },
        { status: 409 }
      )
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const parsed = parseContractorPricingRequest(body);
  if (!parsed.ok) {
    return applyTo(NextResponse.json({ error: parsed.error }, { status: 400 }));
  }

  const rows = toCanonicalRows(parsed.value);

  // The generated function signature expects Json args and undefined (not
  // null) for the optional ones; CanonicalPricingRow/TaxInput and this route's
  // null-based optionality don't line up with that cleanly, so this one call
  // is still cast. Everything it returns is narrowed by hand above rather than
  // trusted.
  const { data, error } = await (
    supabaseAdmin.rpc as unknown as (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("tpe_save_contractor_pricing", {
    p_estimate_id: id,
    p_business_id: business.id,
    p_rows: rows,
    p_tax: parsed.value.tax,
    p_first_hourly_rate: firstHourlyRateCandidate(parsed.value),
  });

  if (error) {
    // The function raised, so the whole transaction rolled back: rows,
    // snapshots, status and business defaults are all as they were.
    console.error("[estimates/pricing] save refused:", error.message);
    const mapped = statusForDatabaseError(error.message);
    return applyTo(NextResponse.json({ error: mapped.error }, { status: mapped.status }));
  }

  const saved = narrowSavedState(data);
  if (!saved) {
    console.error("[estimates/pricing] unreadable save result");
    return applyTo(NextResponse.json({ error: "Could not save pricing" }, { status: 500 }));
  }

  const snapshots: PricingSnapshots = {
    taxRatePercent: saved.tax_rate_snapshot,
    depositPercent: saved.deposit_percent_snapshot,
    depositThresholdDollars: saved.deposit_threshold_snapshot,
  };
  const pricingRows: PricingRow[] = saved.rows.map((row) => ({
    item_type: row.item_type,
    unit: row.unit,
    quantity: row.quantity,
    unit_price: row.unit_price,
    markup_percent: row.markup_percent,
  }));

  // The one arithmetic implementation. Never duplicated here or in SQL.
  const pricing = calculateContractorPricing(pricingRows, snapshots);

  return applyTo(
    NextResponse.json({
      estimate: {
        id: saved.estimate_id,
        status: saved.status,
        pricingSource: saved.pricing_source,
        promoted: saved.promoted,
        taxLabel: saved.tax_label_snapshot,
        taxRate: saved.tax_rate_snapshot,
        depositPercent: saved.deposit_percent_snapshot,
        depositThreshold: saved.deposit_threshold_snapshot,
      },
      rows: saved.rows,
      pricing,
    })
  );
}
