import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.redirect(new URL("/login", request.url)));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  // No customer or no subscription on file means there is nothing for the
  // Portal to manage. Send them to Checkout to subscribe instead.
  // 307 preserves the POST so the checkout route handles it directly.
  if (!business?.stripe_customer_id || !business?.stripe_subscription_id) {
    return applyTo(NextResponse.redirect(new URL("/api/billing/checkout", request.url), 307));
  }

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: business.stripe_customer_id,
      return_url: `${origin}/profile`,
    });

    return applyTo(NextResponse.redirect(session.url, 303));
  } catch (err) {
    // DB state can drift from Stripe (e.g. "No such customer"). Fall back to
    // Checkout rather than failing and leaving the user stuck.
    console.error("[portal] session failed, falling back to checkout:", err instanceof Error ? err.message : err);
    return applyTo(NextResponse.redirect(new URL("/api/billing/checkout", request.url), 307));
  }
}
