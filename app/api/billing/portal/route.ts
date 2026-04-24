import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.redirect(new URL("/login", request.url)));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!business?.stripe_customer_id) {
    return applyTo(NextResponse.redirect(new URL("/subscribe", request.url)));
  }

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://tradepulse.app";

  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripe_customer_id,
    return_url: `${origin}/profile`,
  });

  return applyTo(NextResponse.redirect(session.url, 303));
}
