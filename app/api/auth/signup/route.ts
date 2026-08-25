import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { provisionNewAccount } from "@/lib/account-provisioning";
import { createAccountProvisioningDependencies } from "@/lib/account-provisioning-server";
import { currencyOrDefault } from "@/lib/currency";
import { businessEstimateCurrencyPatch } from "@/lib/currency-db";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let body: { email?: unknown; password?: unknown; signup_source?: unknown; plan?: unknown; currency?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { email, password, signup_source } = body;
  const plan = body.plan === "pro" ? "pro" : "starter";
  // Allowlisted server-side. Anything unrecognised, tampered, or missing
  // falls back to CAD rather than failing the signup.
  const currency = currencyOrDefault(body.currency);
  const url = new URL(request.url);
  const refParam = url.searchParams.get("ref")?.trim() || undefined;
  const signupSource =
    (typeof signup_source === "string" && signup_source.trim() ? signup_source.trim() : undefined) ?? refParam;
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (typeof password !== "string" || !password.trim()) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }
  if (password.trim().length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const { allowed } = await checkRateLimit(supabaseAdmin, ip, "signup", 5, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429 }
    );
  }

  // Cookies from signUp are collected here and applied to the final response,
  // once the body (which now includes userId) is known.
  const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookies) { pendingCookies.push(...(cookies as typeof pendingCookies)); },
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

  // Stripe customer, trial subscription, then the business row. A failure at
  // any step compensates the whole attempt: business row, then Stripe
  // customer (which cancels its subscription), then the Auth user last. See
  // lib/account-provisioning.ts for why that order matters.
  const provisioned = await provisionNewAccount(
    createAccountProvisioningDependencies(async (record) => {
      const { error: dbError } = await supabaseAdmin
        .from("tpe_businesses")
        .upsert(
          {
            owner_user_id: userId,
            name: "",
            slug: userId,
            plan,
            subscription_status: record.subscriptionStatus,
            trial_ends_at: record.trialEndsAt,
            stripe_customer_id: record.customerId,
            stripe_subscription_id: record.subscriptionId,
            email,
            ...businessEstimateCurrencyPatch(currency),
            ...(signupSource ? { signup_source: signupSource } : {}),
          },
          { onConflict: "owner_user_id" }
        );

      if (dbError) throw new Error(dbError.message);
    }),
    { userId, email, plan, currency, deleteAuthUserOnFailure: true }
  );

  if (!provisioned.ok) {
    console.error(
      `[signup] provisioning failed at ${provisioned.stage}:`,
      provisioned.error instanceof Error ? provisioned.error.message : provisioned.error
    );

    // Cookies from signUp are deliberately not applied on this path, so a
    // failed attempt never leaves a usable session behind.
    if (provisioned.cleanupFailed) {
      return NextResponse.json(
        { error: "Account setup could not be completed. Please contact support before trying again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "Account setup failed. Please try again." }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, userId });
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  );
  return response;
}
