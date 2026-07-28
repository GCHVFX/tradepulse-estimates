import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { STARTER_MONTHLY_PHOTO_LIMIT } from "@/lib/rate-limit";

interface ProfileBody {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  logo_url?: unknown;
  prepared_by?: unknown;
  google_review_link?: unknown;
  payment_link?: unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data, error } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, phone, email, logo_url, prepared_by, google_review_link, payment_link, plan, subscription_status, trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  // Pro is unlimited, so only look this up for Starter -- and only ever
  // read it here, never increment. The route that actually spends a photo
  // estimate (app/api/analyze-photo) is the sole place that calls
  // checkRateLimit for "analyze-photo-monthly"; this is purely so the UI can
  // show a remaining count before the contractor hits the wall.
  let aiPhotoEstimatesRemaining: number | null = null;
  if (data && data.plan !== "pro") {
    // .limit(1) rather than .maybeSingle(): tpe_rate_limits has no unique
    // constraint on (key, action), so in principle more than one row could
    // be active at once (pre-existing gap, not introduced here) -- this is
    // a display-only read and shouldn't ever throw over it.
    const { data: usageRows } = await supabaseAdmin
      .from("tpe_rate_limits")
      .select("count")
      .eq("key", data.id)
      .eq("action", "analyze-photo-monthly")
      .gt("expires_at", new Date().toISOString())
      .order("count", { ascending: false })
      .limit(1);

    const used = usageRows?.[0]?.count ?? 0;
    aiPhotoEstimatesRemaining = Math.max(0, STARTER_MONTHLY_PHOTO_LIMIT - used);
  }

  return applyTo(
    NextResponse.json({
      profile: data ? { ...data, ai_photo_estimates_remaining: aiPhotoEstimatesRemaining } : null,
    })
  );
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

  const googleReviewLink = typeof body.google_review_link === "string"
    ? body.google_review_link.trim() || null
    : null;

  const paymentLink = typeof body.payment_link === "string"
    ? body.payment_link.trim() || null
    : null;

  const { error } = await supabaseAdmin
    .from("tpe_businesses")
    .update({
        name: typeof body.name === "string" ? body.name.trim() : "",
        phone: typeof body.phone === "string" ? body.phone.trim() : "",
        email: typeof body.email === "string" ? body.email.trim() : "",
        logo_url: typeof body.logo_url === "string" ? body.logo_url.trim() : "",
        prepared_by: typeof body.prepared_by === "string" ? body.prepared_by.trim() : "",
        google_review_link: googleReviewLink,
        payment_link: paymentLink,
      })
    .eq("owner_user_id", user.id);

  if (error) return applyTo(NextResponse.json({ error: error.message }, { status: 500 }));

  return applyTo(NextResponse.json({ success: true }));
}
