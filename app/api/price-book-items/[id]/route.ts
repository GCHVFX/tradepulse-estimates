import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";
import { resolvePriceBookItem } from "@/lib/pricebook-suggestion-resolve";

/**
 * GET resolves one saved price-book item's authoritative current pricing
 * (Phase 2 slice 4). The contractor pricing editor calls this only at the
 * moment a matcher suggestion is accepted -- the suggestion itself carries no
 * price (lib/pricebook-suggestions.ts), so this is the one place a saved
 * item's labour price, material price and taxability are actually read.
 *
 * Scoped to this business and active = true, via
 * lib/pricebook-suggestion-resolve.ts's ownership-first orchestrator: a
 * foreign-business id or an inactive item resolves to the same 404 as a
 * typo'd id, never a distinct response that would leak which case it was.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select(`id, ${SUBSCRIPTION_ACCESS_COLUMNS}`)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!hasSubscriptionAccess(business)) {
    return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));
  }

  const { id } = await params;

  const result = await resolvePriceBookItem(id, business.id, {
    async findActiveOwnedItem(itemId, businessId) {
      const { data } = await supabaseAdmin
        .from("tpe_pricebook_items")
        .select("id, name, labour_price, material_price, taxable")
        .eq("id", itemId)
        .eq("business_id", businessId)
        .eq("active", true)
        .maybeSingle();
      return data ?? null;
    },
  });

  if (!result.ok) {
    return applyTo(NextResponse.json({ error: result.error }, { status: result.status }));
  }

  return applyTo(NextResponse.json({ item: result.item }));
}
