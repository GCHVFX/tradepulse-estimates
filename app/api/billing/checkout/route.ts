import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.redirect(new URL("/login", request.url)));

  // Validate required environment variables
  if (!process.env.STRIPE_PRICE_ID) {
    console.error("[checkout] STRIPE_PRICE_ID not configured");
    return applyTo(NextResponse.json({ error: "Billing not configured" }, { status: 500 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("stripe_customer_id, stripe_subscription_id, name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!business) {
    console.error("[checkout] business not found for user:", user.id);
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  }

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com";

  try {
    // Get or create Stripe customer
    let customerId = business.stripe_customer_id;
    if (!customerId) {
      const customerData: {
        email?: string;
        name?: string;
        metadata: { user_id: string };
      } = {
        metadata: { user_id: user.id },
      };

      if (user.email) customerData.email = user.email;
      if (business.email) customerData.email = business.email;
      if (business.name) customerData.name = business.name;

      const customer = await stripe.customers.create(customerData);
      customerId = customer.id;

      await supabaseAdmin
        .from("tpe_businesses")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    // If the user has a trial subscription in Stripe, cancel it before creating a paid subscription
    if (business.stripe_subscription_id) {
      try {
        const existing = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
        if (existing.status === "trialing") {
          await supabaseAdmin
            .from("tpe_businesses")
            .update({ stripe_subscription_id: null })
            .eq("user_id", user.id);

          await stripe.subscriptions.cancel(business.stripe_subscription_id);
        }
      } catch (err) {
        console.error("[checkout] failed to cancel trial:", err instanceof Error ? err.message : err);
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${origin}/new?subscribed=1`,
      cancel_url: `${origin}/subscribe`,
      metadata: { user_id: user.id },
    });

    if (!session.url) {
      console.error("[checkout] no session URL returned");
      return applyTo(NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 }));
    }

    return applyTo(NextResponse.redirect(session.url, 303));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    console.error("[checkout] error:", message);
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }
}
