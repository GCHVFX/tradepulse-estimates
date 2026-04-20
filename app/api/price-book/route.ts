import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const [ratesResult, itemsResult] = await Promise.all([
    supabaseAdmin
      .from("tpe_price_book")
      .select("labour_rate, markup_percent, deposit_percent, deposit_threshold")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("tpe_price_book_items")
      .select("id, name, unit_price")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  return applyTo(NextResponse.json({
    rates: ratesResult.data ?? { labour_rate: 0, markup_percent: 0, deposit_percent: 0, deposit_threshold: 0 },
    items: itemsResult.data ?? [],
  }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

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

  const { data: existing } = await supabaseAdmin
    .from("tpe_price_book")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = existing
    ? await supabaseAdmin.from("tpe_price_book").update(values).eq("user_id", user.id)
    : await supabaseAdmin.from("tpe_price_book").insert({ user_id: user.id, ...values });

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));
  return applyTo(NextResponse.json({ success: true }));
}
