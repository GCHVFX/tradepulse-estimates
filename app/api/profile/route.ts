import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

interface ProfileBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  logo_url?: unknown;
  prepared_by?: unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data, error } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name, phone, email, logo_url, prepared_by, subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  return applyTo(NextResponse.json({ profile: data ?? null }));
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  let body: ProfileBody;
  try {
    body = (await request.json()) as ProfileBody;
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const { error } = await supabaseAdmin
    .from("tpe_businesses")
    .upsert(
      {
        user_id: user.id,
        name: typeof body.name === "string" ? body.name.trim() : "",
        phone: typeof body.phone === "string" ? body.phone.trim() : "",
        email: typeof body.email === "string" ? body.email.trim() : "",
        logo_url: typeof body.logo_url === "string" ? body.logo_url.trim() : "",
        prepared_by: typeof body.prepared_by === "string" ? body.prepared_by.trim() : "",
      },
      { onConflict: "user_id" }
    );

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  return applyTo(NextResponse.json({ success: true }));
}
