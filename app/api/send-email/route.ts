import { checkUserSubscriptionAccess } from "@/lib/auth";
import { logEstimateChange } from "@/lib/audit-log";
import { validateContentType } from "@/lib/api-utils";
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

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

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

  const { hasAccess } = await checkUserSubscriptionAccess(user.id, supabaseAdmin);
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  // Get business info
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, email")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  }

  // Verify ownership of estimate
  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, customer_name")
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found" }, { status: 404 }));
  }

  const origin =
    request.headers.get("origin") ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.trytradepulse.com";

  const shareUrl = `${origin}/share/${estimateId}`;
  const businessName = business?.name?.trim() ?? "";
  const customerName = (estimate.customer_name ?? "").trim();
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const sender = businessName || "We";
  const subject = businessName ? `Your estimate from ${businessName}` : "Your estimate is ready";

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({
      from: "TradePulse Estimates <estimates@trytradepulse.com>",
      to: to.trim(),
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
          <p style="font-size: 16px; margin: 0 0 16px;">${greeting}</p>
          <p style="font-size: 16px; margin: 0 0 24px;">
            ${sender} sent you an estimate. Click below to view it.
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

    // Update estimate status with double ownership check
    const { error: updateError } = await supabaseAdmin
      .from("tpe_estimates")
      .update({
        status: "sent",
        sent_via: "email",
        sent_at: new Date().toISOString(),
      })
      .eq("id", estimateId)
      .eq("business_id", business.id);

    if (updateError) {
      console.error("[send-email] update failed:", updateError.message);
      return applyTo(NextResponse.json({ error: "Failed to update estimate" }, { status: 500 }));
    }

    // Log email send
    await logEstimateChange(
      supabaseAdmin,
      estimateId,
      user.id,
      "sent",
      undefined,
      { sent_via: "email", sent_at: new Date().toISOString() }
    );

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