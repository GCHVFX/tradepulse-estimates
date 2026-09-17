import { checkUserSubscriptionAccess } from "@/lib/auth";
import { logEstimateChange } from "@/lib/audit-log";
import { validateContentType } from "@/lib/api-utils";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { claimDelivery, markDeliverySent } from "@/lib/delivery-claims";
import { classifyEstimate } from "@/lib/estimate-classification";
import { isDeliveredContractorPricing } from "@/lib/estimate-delivery";
import { contractorPricingCompleteness } from "@/lib/estimate-pricing-server";
import { normalizeEmail } from "@/lib/request-guards";
import { canonicalUrl } from "@/lib/site-url";
import { ESTIMATES_FROM } from "@/lib/email-addresses";

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

  const suppliedEmail = typeof to === "string" ? normalizeEmail(to) : null;
  if (!suppliedEmail) {
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
    .select(
      "id, customer_name, customer_email, sent_at, copied_at, pricing_source, source, status, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot"
    )
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    return applyTo(NextResponse.json({ error: "Estimate not found" }, { status: 404 }));
  }

  // Classification first (specs/contractor-owned-pricing.md section 2), then
  // the same completeness gate PATCH /api/estimates and send-sms share
  // (section 13). No side effect has happened yet: nothing is claimed, no
  // email sent.
  const pricingClass = classifyEstimate(estimate);
  if (pricingClass === "contractor_pricing") {
    const pricing = await contractorPricingCompleteness(estimateId, estimate);
    if (!pricing.complete) {
      return applyTo(
        NextResponse.json(
          { error: "This estimate is missing pricing information and cannot be sent yet" },
          { status: 409 }
        )
      );
    }
  }

  const storedEmail = estimate.customer_email ? normalizeEmail(estimate.customer_email) : null;
  if (storedEmail && storedEmail !== suppliedEmail) {
    return applyTo(NextResponse.json({ error: "Use the customer email saved on this estimate" }, { status: 400 }));
  }
  const recipient = storedEmail ?? suppliedEmail;

  let claimId: string | null;
  try {
    claimId = await claimDelivery(supabaseAdmin, {
      businessId: business.id,
      estimateId,
      channel: "email",
      recipient,
      action: "estimate-send",
      stage: estimate.sent_at ? `resend-${estimate.sent_at}` : "initial",
    });
  } catch {
    return applyTo(NextResponse.json({ error: "Unable to prepare email delivery" }, { status: 503 }));
  }
  if (!claimId) {
    return applyTo(NextResponse.json({ error: "This email send is already in progress" }, { status: 409 }));
  }

  // Pinned to the canonical host, never SITE_URL. A share link is a
  // permanent artifact that ends up sitting in a customer's phone, so it
  // must never resolve to a Vercel deployment URL or a stale env value, for
  // the same reason as the SMS share link in app/api/send-sms/route.ts.
  const shareUrl = canonicalUrl(`/share/${estimateId}`);
  const businessName = business?.name?.trim() ?? "";
  const customerName = (estimate.customer_name ?? "").trim();
  const greeting = customerName ? `Hi ${customerName},` : "Hi,";
  const sender = businessName || "We";
  const subject = businessName ? `Your estimate from ${businessName}` : "Your estimate is ready";

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({
      from: ESTIMATES_FROM,
      to: recipient,
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

    await markDeliverySent(supabaseAdmin, claimId);

    // Update estimate status with double ownership check
    const { error: updateError } = await supabaseAdmin
      .from("tpe_estimates")
      .update({
        status: "sent",
        sent_via: "email",
        sent_at: new Date().toISOString(),
        // A contractor_pricing estimate already delivered through some other
        // channel (e.g. copy link, with no email ever entered) must not have
        // its customer-visible document silently gain an email address now
        // -- the share page renders customer_email when present, so this is
        // a document edit, not a delivery-mechanics detail. This only ever
        // skips a write that would otherwise happen; it never blocks the
        // send itself.
        ...(!storedEmail && !isDeliveredContractorPricing(estimate) ? { customer_email: recipient } : {}),
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
