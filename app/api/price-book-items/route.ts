import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: sub } = await supabaseAdmin
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const isActive = sub?.subscription_status === "active";
  const isTrialing = sub?.subscription_status === "trial" && sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || sub?.subscription_status === "complimentary";
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

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
    .from("tpe_price_book_items")
    .insert({
      user_id: user.id,
      name: body.name.trim(),
      unit_price: Number(body.unit_price) || 0,
    })
    .select()
    .single();

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ item: data }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: sub } = await supabaseAdmin
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const isActive = sub?.subscription_status === "active";
  const isTrialing = sub?.subscription_status === "trial" && sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || sub?.subscription_status === "complimentary";
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

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
    .from("tpe_price_book_items")
    .update({
      name: body.name.trim(),
      unit_price: Number(body.unit_price) || 0,
    })
    .eq("id", body.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ item: data }));
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: sub } = await supabaseAdmin
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const isActive = sub?.subscription_status === "active";
  const isTrialing = sub?.subscription_status === "trial" && sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || sub?.subscription_status === "complimentary";
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return applyTo(NextResponse.json({ error: "id is required" }, { status: 400 }));

  const { error } = await supabaseAdmin
    .from("tpe_price_book_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ success: true }));
}
