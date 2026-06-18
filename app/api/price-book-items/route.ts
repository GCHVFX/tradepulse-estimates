import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

async function getBusinessWithAccess(userId: string) {
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, subscription_status, trial_ends_at")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (!business) return null;

  const isActive = business.subscription_status === "active";
  const isTrialing = business.subscription_status === "trial" && business.trial_ends_at && new Date(business.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || business.subscription_status === "complimentary";

  return hasAccess ? business : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const business = await getBusinessWithAccess(user.id);
  if (!business) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  let body: { name?: unknown; unit_price?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return applyTo(NextResponse.json({ error: "Name is required" }, { status: 400 }));
  }

  const { data, error } = await supabaseAdmin
    .from("tpe_pricebook_items")
    .insert({
      business_id: business.id,
      name: body.name.trim(),
      labour_price: Number(body.unit_price) || 0,
      category: "General",
      material_price: 0,
      taxable: true,
      active: true,
    })
    .select()
    .single();

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({
    item: {
      id: data.id,
      name: data.name,
      unit_price: data.labour_price,
    },
  }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const business = await getBusinessWithAccess(user.id);
  if (!business) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  let body: { id?: unknown; name?: unknown; unit_price?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  if (typeof body.id !== "string" || !body.id.trim()) {
    return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return applyTo(NextResponse.json({ error: "Name is required" }, { status: 400 }));
  }

  const { data, error } = await supabaseAdmin
    .from("tpe_pricebook_items")
    .update({
      name: body.name.trim(),
      labour_price: Number(body.unit_price) || 0,
    })
    .eq("id", body.id)
    .eq("business_id", business.id)
    .select()
    .single();

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({
    item: {
      id: data.id,
      name: data.name,
      unit_price: data.labour_price,
    },
  }));
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const business = await getBusinessWithAccess(user.id);
  if (!business) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));

  const { error } = await supabaseAdmin
    .from("tpe_pricebook_items")
    .delete()
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ success: true }));
}
