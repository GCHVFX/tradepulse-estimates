import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";
import { checkRateLimit } from "@/lib/rate-limit";
import { isDeletedStripeObject } from "@/lib/stripe-object-state";
import type { Currency } from "@/lib/currency";
import { lockedSubscriptionCurrency } from "@/lib/billing-currency";
import { readBusinessEstimateCurrency } from "@/lib/currency-db";
import { SITE_URL } from "@/lib/site-url";

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
    .select("id, stripe_customer_id, stripe_subscription_id, name, email, plan, subscription_status")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    console.error("[checkout] business not found for user:", user.id);
    return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));
  }

  const checkoutLimit = await checkRateLimit(supabaseAdmin, business.id, "stripe-checkout", 5, 900);
  if (!checkoutLimit.allowed) {
    return applyTo(NextResponse.json({ error: "Too many checkout attempts. Try again shortly." }, { status: 429 }));
  }

  const origin = request.headers.get("origin") ?? SITE_URL;

  try {
    // Get or create Stripe customer
    let customerId = business.stripe_customer_id;

    // If customer ID exists, verify it's still valid in Stripe
    if (customerId) {
      try {
        const existingCustomer = await stripe.customers.retrieve(customerId);
        // A deleted customer still retrieves successfully, so this check has
        // to happen on the resolved value. Stripe blocks every further
        // operation on it, so reusing one would fail at session creation.
        if (isDeletedStripeObject(existingCustomer)) {
          console.warn("[checkout] stored customer is deleted in Stripe, recreating:", customerId);
          customerId = null; // Force recreation
        }
      } catch {
        console.warn("[checkout] customer not found in Stripe, recreating:", customerId);
        customerId = null; // Force recreation
      }
    }

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
        .eq("owner_user_id", user.id);
    }

    // Billing currency. The rule lives in lib/billing-currency.ts so that
    // /subscribe displays exactly what this route will charge. Behaviour is
    // unchanged: a current subscription still wins, a cancelled or expired one
    // still does not, and the business estimate currency is still the fallback.
    let billingCurrency: Currency | null = null;
    let previousSubscriptionId: string | undefined;

    // If the user has a trial subscription in Stripe, cancel it only after
    // paid checkout completes. Otherwise backing out of Stripe would remove
    // the trial subscription before the user actually subscribes.
    if (business.stripe_subscription_id) {
      try {
        const existing = await stripe.subscriptions.retrieve(business.stripe_subscription_id);
        billingCurrency = lockedSubscriptionCurrency(existing);
        if (existing.status === "trialing") {
          previousSubscriptionId = business.stripe_subscription_id;
        }
      } catch (err) {
        console.error("[checkout] failed to inspect trial:", err instanceof Error ? err.message : err);
      }
    }

    const url = new URL(request.url);
    const plan = url.searchParams.get("plan") === "pro" ? "pro" : "starter";

    if (business.subscription_status === "active") {
      if (business.plan === "pro") {
        return applyTo(NextResponse.redirect(new URL("/profile", request.url), 303));
      }

      return applyTo(NextResponse.redirect(new URL("/subscribe", request.url), 303));
    }

    const priceId = plan === "pro" ? process.env.STRIPE_PRO_PRICE_ID : process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      console.error(`[checkout] ${plan} price ID not configured`);
      return applyTo(NextResponse.json({ error: "Billing not configured" }, { status: 500 }));
    }

    const resolvedCurrency: Currency =
      billingCurrency ?? (await readBusinessEstimateCurrency(supabaseAdmin, business.id));

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      // Explicit currency, so the multi-currency Price resolves deterministically.
      currency: resolvedCurrency,
      // Never let Stripe convert on our behalf: TradePulse sells in CAD and USD
      // only, at deliberate price points, not exchange-rate derived ones.
      adaptive_pricing: { enabled: false },
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/new?subscribed=1`,
      cancel_url: `${origin}/subscribe`,
      metadata: {
        user_id: user.id,
        plan,
        ...(previousSubscriptionId ? { previous_subscription_id: previousSubscriptionId } : {}),
      },
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
