import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return applyTo(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applyTo(
      NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    );
  }

  const { to, estimateId } = body as {
    to?: unknown;
    estimateId?: unknown;
  };

  if (typeof to !== "string" || !to.trim()) {
    return applyTo(
      NextResponse.json({ error: "Email address is required" }, { status: 400 })
    );
  }

  if (typeof estimateId !== "string" || !estimateId.trim()) {
    return applyTo(
      NextResponse.json({ error: "estimateId is required" }, { status: 400 })
    );
  }

  if (!process.env.RESEND_API_KEY) {
    return applyTo(
      NextResponse.json(
        { error: "RESEND_API_KEY is not configured" },
        { status: 500 }
      )
    );
  }

  const { data: sub } = await supabaseAdmin
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const isActive = sub?.subscription_status === "active";
  const isTrialing = sub?.subscription_status === "trial" && sub?.trial_ends_at && new Date(sub.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || sub?.subscription_status === "complimentary";
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  // Get business info
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  const origin =
    request.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.trytradepulse.com";

  const shareUrl = `${origin}/share/${estimateId}`;
  const businessName = business?.name || "Your contractor";

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({
      // Replace this with your verified domain in Resend
      from: "TradePulse Estimates <estimates@trytradepulse.com>",
      to: to.trim(),
      subject: `Your estimate from ${businessName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
          <p style="font-size: 16px; margin: 0 0 16px;">Hi,</p>
          <p style="font-size: 16px; margin: 0 0 24px;">
            ${businessName} has sent you an estimate. Click below to view it.
          </p>
          <a
            href="${shareUrl}"
            style="display: inline-block; background: #f59e0b; color: #111; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 10px; text-decoration: none;"
          >
            View Estimate
          </a>
          <p style="font-size: 13px; color: #888; margin: 24px 0 0;">
            Or copy this link: ${shareUrl}
          </p>
        </div>
      `,
    });

    if (result.error) {
      console.error("Resend error:", result.error);
      return applyTo(
        NextResponse.json(
          { error: result.error.message || "Email send failed" },
          { status: 500 }
        )
      );
    }

    // Update estimate status
    await supabaseAdmin
      .from("tpe_estimates")
      .update({
        status: "sent",
        sent_via: "email",
        sent_at: new Date().toISOString(),
      })
      .eq("id", estimateId)
      .eq("business_id", user.id);

    return applyTo(NextResponse.json({ success: true }));
  } catch (err) {
    console.error("Send email route error:", err);

    return applyTo(
      NextResponse.json(
        {
          error:
            err instanceof Error ? err.message : "Email send failed",
        },
        { status: 500 }
      )
    );
  }
}