import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const subSelect = "subscription_status, trial_ends_at";
function checkAccess(sub: { subscription_status?: string; trial_ends_at?: string | null } | null) {
  const isActive = sub?.subscription_status === "active";
  const isTrialing = sub?.subscription_status === "trial" && sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date();
  return isActive || isTrialing || sub?.subscription_status === "complimentary";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, subscription_status, trial_ends_at, labour_rate, markup_percent, deposit_percent, deposit_threshold")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!checkAccess(business)) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  const { data: items } = await supabaseAdmin
    .from("tpe_pricebook_items")
    .select("id, name, description, labour_price")
    .eq("business_id", business!.id)
    .order("created_at", { ascending: true });

  return applyTo(NextResponse.json({
    rates: {
      labour_rate: business!.labour_rate ?? 0,
      markup_percent: business!.markup_percent ?? 0,
      deposit_percent: business!.deposit_percent ?? 0,
      deposit_threshold: business!.deposit_threshold ?? 0,
    },
    items: (items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? "",
      unit_price: item.labour_price,
    })),
  }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, subscription_status, trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!checkAccess(business)) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  let body: { labour_rate?: unknown; markup_percent?: unknown; deposit_percent?: unknown; deposit_threshold?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const values = {
    labour_rate: Number(body.labour_rate) || 0,
    markup_percent: Number(body.markup_percent) || 0,
    deposit_percent: Number(body.deposit_percent) || 0,
    deposit_threshold: Number(body.deposit_threshold) || 0,
  };

  const { error } = await supabaseAdmin
    .from("tpe_businesses")
    .update(values)
    .eq("owner_user_id", user.id);

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ success: true }));
}
