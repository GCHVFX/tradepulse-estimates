import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("plan, subscription_status, stripe_subscription_id, stripe_customer_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  if (business.plan === "pro") return applyTo(NextResponse.json({ error: "Already on Pro" }, { status: 400 }));

  if (business.subscription_status === "trial") {
    await supabaseAdmin
      .from("tpe_businesses")
      .update({ plan: "pro" })
      .eq("owner_user_id", user.id);
    return applyTo(NextResponse.json({ upgraded: true }));
  }

  if (business.subscription_status === "active" && business.stripe_subscription_id) {
    const subscription = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
    const itemId = subscription.items.data[0].id;
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com";

    const session = await stripe.billingPortal.sessions.create({
      customer: business.stripe_customer_id!,
      return_url: `${origin}/profile?upgraded=1`,
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: business.stripe_subscription_id,
          items: [{ id: itemId, price: process.env.STRIPE_PRO_PRICE_ID! }],
        },
      },
    });

    return applyTo(NextResponse.json({ redirectUrl: session.url }));
  }

  return applyTo(NextResponse.json({ error: "No active subscription" }, { status: 400 }));
}
