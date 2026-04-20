import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.redirect(new URL("/login", request.url)));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("stripe_customer_id, stripe_subscription_id, name")
    .eq("user_id", user.id)
    .maybeSingle();

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://tradepulse.app";

  // Get or create Stripe customer
  let customerId = business?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: business?.name ?? undefined,
      metadata: { user_id: user.id },
    });
    customerId = customer.id;

    await supabaseAdmin
      .from("tpe_businesses")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", user.id);
  }

  // If the user has a trial subscription in Stripe, cancel it before creating a
  // paid subscription. Clear stripe_subscription_id first so the deleted webhook
  // does not match and incorrectly set subscription_status to "canceled".
  if (business?.stripe_subscription_id) {
    try {
      const existing = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
      if (existing.status === "trialing") {
        await supabaseAdmin
          .from("tpe_businesses")
          .update({ stripe_subscription_id: null })
          .eq("user_id", user.id);

        await stripe.subscriptions.cancel(business.stripe_subscription_id);
      }
    } catch {
      // Subscription may already be gone — proceed with checkout regardless
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${origin}/new?subscribed=1`,
    cancel_url: `${origin}/subscribe`,
    metadata: { user_id: user.id },
  });

  return applyTo(NextResponse.redirect(session.url!, 303));
}
