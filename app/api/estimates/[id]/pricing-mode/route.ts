import { NextRequest, NextResponse } from "next/server";
import { isGroupedPricingEnabled } from "@/lib/estimate-groups";
import {
  updateCustomerPricingMode,
  type CustomerPricingModeDependencies,
} from "@/lib/estimate-pricing-mode";
import {
  loadStructuredPricingItems,
  toEstimatePricingRecord,
} from "@/lib/estimate-pricing-server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { id } = await params;
  if (!user) {
    return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  let body: { mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const dependencies: CustomerPricingModeDependencies = {
    featureEnabled: isGroupedPricingEnabled(),
    findBusinessIdForUser: async (userId) => {
      const { data, error } = await supabaseAdmin
        .from("tpe_businesses")
        .select("id")
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id ?? null;
    },
    findEstimateForBusiness: async (estimateId, businessId) => {
      const { data, error } = await supabaseAdmin
        .from("tpe_estimates")
        .select(
          "id, business_id, pricing_source, customer_pricing_mode, status, sent_at, copied_at, completed_at, payment_status, invoice_amount, review_requested_at, summary, currency"
        )
        .eq("id", estimateId)
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toEstimatePricingRecord(data) : null;
    },
    loadStructuredItems: loadStructuredPricingItems,
    persistMode: async ({ estimateId, businessId, mode }) => {
      const { data, error } = await supabaseAdmin
        .from("tpe_estimates")
        .update({ customer_pricing_mode: mode })
        .eq("id", estimateId)
        .eq("business_id", businessId)
        .eq("pricing_source", "structured")
        .eq("status", "draft")
        .is("sent_at", null)
        .is("copied_at", null)
        .is("completed_at", null)
        .is("payment_status", null)
        .is("invoice_amount", null)
        .is("review_requested_at", null)
        .select("id");
      return { updated: !error && (data?.length ?? 0) === 1, error: error?.message };
    },
  };

  try {
    const result = await updateCustomerPricingMode(
      { userId: user.id, estimateId: id, requestedMode: body.mode },
      dependencies
    );

    if (result.internalError) {
      console.error("[estimate-pricing-mode] update failed", {
        estimateId: id,
        error: result.internalError,
      });
    }

    return applyTo(
      NextResponse.json(
        result.ok ? { success: true, mode: result.mode } : { error: result.error },
        { status: result.status }
      )
    );
  } catch (error) {
    console.error("[estimate-pricing-mode] request failed", {
      estimateId: id,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return applyTo(
      NextResponse.json({ error: "Could not save customer pricing" }, { status: 500 })
    );
  }
}
