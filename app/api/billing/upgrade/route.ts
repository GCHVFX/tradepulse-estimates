import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

function wantsHtmlRedirect(request: NextRequest): boolean {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

function respondWithUrl(request: NextRequest, applyTo: (response: NextResponse) => NextResponse, url: string): NextResponse {
  if (wantsHtmlRedirect(request)) {
    return applyTo(NextResponse.redirect(url, 303));
  }

  return applyTo(NextResponse.json({ redirectUrl: url }));
}

function respondWithError(
  request: NextRequest,
  applyTo: (response: NextResponse) => NextResponse,
  message: string,
  status: number
): NextResponse {
  if (wantsHtmlRedirect(request)) {
    return applyTo(NextResponse.redirect(new URL("/subscribe", request.url), 303));
  }

  return applyTo(NextResponse.json({ error: message }, { status }));
}

type UpgradeBusiness = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  name: string | null;
  email: string | null;
};

async function createProCheckoutUrl(
  request: NextRequest,
  user: { id: string; email?: string },
  business: UpgradeBusiness
): Promise<string | null> {
  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com";
  let customerId = business.stripe_customer_id;
  let previousSubscriptionId: string | undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: business.email || user.email,
      name: business.name || undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;

    await supabaseAdmin
      .from("tpe_businesses")
      .update({ stripe_customer_id: customerId })
      .eq("owner_user_id", user.id);
  }

  if (business.stripe_subscription_id) {
    try {
      const existing = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
      if (existing.status === "trialing") {
        previousSubscriptionId = business.stripe_subscription_id;
      }
    } catch (err) {
      console.error("[upgrade] failed to inspect trial:", err instanceof Error ? err.message : err);
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    success_url: `${origin}/profile?upgraded=1`,
    cancel_url: `${origin}/subscribe`,
    metadata: {
      user_id: user.id,
      plan: "pro",
      ...(previousSubscriptionId ? { previous_subscription_id: previousSubscriptionId } : {}),
    },
  });

  return session.url ?? null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (wantsHtmlRedirect(request)) {
      return applyTo(NextResponse.redirect(new URL("/login", request.url), 303));
    }

    return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("plan, subscription_status, stripe_subscription_id, stripe_customer_id, name, email")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return respondWithError(request, applyTo, "Business not found", 404);
  if (business.plan === "pro") return respondWithError(request, applyTo, "Already on Pro", 400);

  if (!process.env.STRIPE_PRO_PRICE_ID) {
    console.error("[upgrade] STRIPE_PRO_PRICE_ID not configured");
    return respondWithError(request, applyTo, "Pro billing not configured", 500);
  }

  if (business.subscription_status === "trial") {
    const url = await createProCheckoutUrl(request, user, business);

    if (!url) {
      return respondWithError(request, applyTo, "Failed to create checkout session", 500);
    }

    return respondWithUrl(request, applyTo, url);
  }

  if (business.subscription_status === "active" && business.stripe_subscription_id) {
    try {
      const subscription = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
      const itemId = subscription.items.data[0]?.id;
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com";

      if (!itemId || !business.stripe_customer_id) {
        return respondWithError(request, applyTo, "Subscription not ready for upgrade", 400);
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: business.stripe_customer_id,
        return_url: `${origin}/profile?upgraded=1`,
        flow_data: {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: business.stripe_subscription_id,
            items: [{ id: itemId, price: process.env.STRIPE_PRO_PRICE_ID! }],
          },
        },
      });

      return respondWithUrl(request, applyTo, session.url);
    } catch (err) {
      // DB state can drift from Stripe (e.g. "No such customer" or a
      // subscription deleted in Stripe). Fall back to Checkout instead of
      // failing the request.
      console.error("[upgrade] portal failed, falling back to checkout:", err instanceof Error ? err.message : err);

      try {
        const url = await createProCheckoutUrl(request, user, business);
        if (url) return respondWithUrl(request, applyTo, url);
      } catch (checkoutErr) {
        console.error("[upgrade] checkout fallback failed:", checkoutErr instanceof Error ? checkoutErr.message : checkoutErr);
      }

      return respondWithError(request, applyTo, "Could not open billing", 500);
    }
  }

  return respondWithError(request, applyTo, "No active subscription", 400);
}
