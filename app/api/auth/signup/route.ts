import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";

const signupRateLimit = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const rl = signupRateLimit.get(ip);
  if (rl && now < rl.resetAt) {
    if (rl.count >= 5) {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }
    rl.count++;
  } else {
    signupRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
  }

  let body: { email?: unknown; password?: unknown; signup_source?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { email, password, signup_source } = body;
  const signupSource = typeof signup_source === "string" && signup_source.trim() ? signup_source.trim() : undefined;
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (typeof password !== "string" || !password.trim()) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }
  if (password.trim().length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // Build the response early so session cookies from signUp can be written onto it
  const response = NextResponse.json({ success: true });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

  if (signUpError || !data.user) {
    return NextResponse.json(
      { error: signUpError?.message ?? "Failed to create account" },
      { status: 400 }
    );
  }

  const userId = data.user.id;

  let customer: { id: string } | undefined;

  try {
    customer = await stripe.customers.create({
      email,
      metadata: { user_id: userId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID! }],
      trial_period_days: 14,
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
    });

    const trialEndsAt = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: dbError } = await supabaseAdmin
      .from("tpe_businesses")
      .upsert(
        {
          user_id: userId,
          name: "",
          subscription_status: "trial",
          trial_ends_at: trialEndsAt,
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          ...(signupSource ? { signup_source: signupSource } : {}),
        },
        { onConflict: "user_id" }
      );

    if (dbError) {
      console.error("tpe_businesses upsert failed:", dbError.message);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: "Account setup failed. Please try again." }, { status: 500 });
    }
  } catch (err) {
    // Stripe or DB failed — remove the auth user so they can try again cleanly
    await supabaseAdmin.auth.admin.deleteUser(userId);
    try { if (customer?.id) await stripe.customers.del(customer.id); } catch {}
    const message = err instanceof Error ? err.message : "Account setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return response;
}
